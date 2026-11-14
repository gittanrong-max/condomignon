create table public.people (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 120),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique (organization_id, id)
);

create table public.charges (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  person_id uuid not null,
  description text not null check (char_length(btrim(description)) between 1 and 240),
  amount_cents bigint not null check (
    amount_cents between 1 and 9007199254740991
  ),
  due_date date not null,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique (organization_id, id),
  foreign key (organization_id, person_id)
    references public.people(organization_id, id) on delete restrict
);

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  charge_id uuid not null,
  amount_cents bigint not null check (
    amount_cents between 1 and 9007199254740991
  ),
  paid_at date not null default current_date,
  note text check (note is null or char_length(note) <= 500),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  foreign key (organization_id, charge_id)
    references public.charges(organization_id, id) on delete restrict
);

create index people_organization_id_idx
  on public.people(organization_id);
create index charges_organization_due_date_idx
  on public.charges(organization_id, due_date);
create index charges_organization_person_idx
  on public.charges(organization_id, person_id);
create index payments_organization_charge_idx
  on public.payments(organization_id, charge_id);

alter table public.people enable row level security;
alter table public.charges enable row level security;
alter table public.payments enable row level security;

revoke all on table public.people, public.charges, public.payments
  from public, anon, authenticated;

grant select, insert on table public.people, public.charges to authenticated;
grant select on table public.payments to authenticated;

create policy "Organization members can read people"
  on public.people
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.organization_members as member
      where member.organization_id = people.organization_id
        and member.user_id = (select auth.uid())
    )
  );

create policy "Organization members can add people"
  on public.people
  for insert
  to authenticated
  with check (
    created_by = (select auth.uid())
    and exists (
      select 1
      from public.organization_members as member
      where member.organization_id = people.organization_id
        and member.user_id = (select auth.uid())
    )
  );

create policy "Organization members can read charges"
  on public.charges
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.organization_members as member
      where member.organization_id = charges.organization_id
        and member.user_id = (select auth.uid())
    )
  );

create policy "Organization members can add charges"
  on public.charges
  for insert
  to authenticated
  with check (
    created_by = (select auth.uid())
    and exists (
      select 1
      from public.organization_members as member
      where member.organization_id = charges.organization_id
        and member.user_id = (select auth.uid())
    )
    and exists (
      select 1
      from public.people
      where people.id = charges.person_id
        and people.organization_id = charges.organization_id
    )
  );

create policy "Organization members can read payments"
  on public.payments
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.organization_members as member
      where member.organization_id = payments.organization_id
        and member.user_id = (select auth.uid())
    )
  );

create or replace function public.record_payment(
  p_charge_id uuid,
  p_amount_cents bigint,
  p_paid_at date default current_date,
  p_note text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := (select auth.uid());
  target_organization_id uuid;
  charge_amount_cents bigint;
  existing_payments_cents bigint;
  new_payment_id uuid;
begin
  if caller_id is null then
    raise exception 'You must be signed in to record a payment';
  end if;

  if p_amount_cents is null
    or p_amount_cents not between 1 and 9007199254740991 then
    raise exception 'Payment amount must be a positive amount';
  end if;

  if p_note is not null and char_length(p_note) > 500 then
    raise exception 'Payment note must be 500 characters or fewer';
  end if;

  select charges.organization_id, charges.amount_cents
    into target_organization_id, charge_amount_cents
    from public.charges
    where charges.id = p_charge_id
    for update;

  if not found or not exists (
    select 1
    from public.organization_members as member
    where member.organization_id = target_organization_id
      and member.user_id = caller_id
  ) then
    raise exception 'Charge not found or you do not have access to it';
  end if;

  select coalesce(sum(payments.amount_cents), 0)
    into existing_payments_cents
    from public.payments
    where payments.organization_id = target_organization_id
      and payments.charge_id = p_charge_id;

  if existing_payments_cents + p_amount_cents > charge_amount_cents then
    raise exception 'Payment exceeds the remaining amount due';
  end if;

  insert into public.payments (
    organization_id,
    charge_id,
    amount_cents,
    paid_at,
    note,
    created_by
  )
  values (
    target_organization_id,
    p_charge_id,
    p_amount_cents,
    coalesce(p_paid_at, current_date),
    nullif(btrim(p_note), ''),
    caller_id
  )
  returning id into new_payment_id;

  return new_payment_id;
end;
$$;

revoke all on function public.record_payment(uuid, bigint, date, text)
  from public, anon;
grant execute on function public.record_payment(uuid, bigint, date, text)
  to authenticated;
