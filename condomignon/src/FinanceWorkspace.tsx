import { useEffect, useState, type FormEvent } from 'react'
import { supabase } from './supabase'

type OrganizationAccess = {
  id: string
  name: string
  role: string
}

type Person = {
  id: string
  name: string
}

type Charge = {
  id: string
  person_id: string
  description: string
  amount_cents: number | string
  due_date: string
}

type Payment = {
  id: string
  charge_id: string
  amount_cents: number | string
  paid_at: string
  note: string | null
}

type FinanceWorkspaceProps = {
  organizations: OrganizationAccess[]
  userId: string
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error
    ? error.message
    : 'Something went wrong. Please try again.'
}

function amountToCents(value: string): number | null {
  const trimmed = value.trim()
  if (!/^\d+(?:\.\d{1,2})?$/.test(trimmed)) {
    return null
  }

  const [whole, fraction = ''] = trimmed.split('.')
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, '0'))
  return Number.isSafeInteger(cents) && cents > 0 ? cents : null
}

function formatAmount(value: number | string): string {
  return new Intl.NumberFormat(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number(value) / 100)
}

function localDateString(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export default function FinanceWorkspace({
  organizations,
  userId,
}: FinanceWorkspaceProps) {
  const [organizationId, setOrganizationId] = useState(organizations[0]?.id ?? '')
  const [people, setPeople] = useState<Person[]>([])
  const [charges, setCharges] = useState<Charge[]>([])
  const [payments, setPayments] = useState<Payment[]>([])
  const [personName, setPersonName] = useState('')
  const [chargePersonId, setChargePersonId] = useState('')
  const [chargeDescription, setChargeDescription] = useState('')
  const [chargeAmount, setChargeAmount] = useState('')
  const [chargeDueDate, setChargeDueDate] = useState(
    localDateString(new Date()),
  )
  const [paymentChargeId, setPaymentChargeId] = useState('')
  const [paymentAmount, setPaymentAmount] = useState('')
  const [paymentDate, setPaymentDate] = useState(localDateString(new Date()))
  const [paymentNote, setPaymentNote] = useState('')
  const [errorMessage, setErrorMessage] = useState('')
  const [notice, setNotice] = useState('')
  const [isLoading, setIsLoading] = useState(true)
  const [isSubmitting, setIsSubmitting] = useState(false)

  useEffect(() => {
    if (!organizations.some((organization) => organization.id === organizationId)) {
      setOrganizationId(organizations[0]?.id ?? '')
    }
  }, [organizationId, organizations])

  useEffect(() => {
    const client = supabase
    if (!client || !organizationId) {
      setPeople([])
      setCharges([])
      setPayments([])
      setIsLoading(false)
      return
    }
    const database = client

    let isCurrent = true
    setIsLoading(true)
    setErrorMessage('')

    async function loadFinanceData() {
      const [peopleResult, chargesResult, paymentsResult] = await Promise.all([
        database
          .from('people')
          .select('id, name')
          .eq('organization_id', organizationId)
          .order('name'),
        database
          .from('charges')
          .select('id, person_id, description, amount_cents, due_date')
          .eq('organization_id', organizationId)
          .order('due_date'),
        database
          .from('payments')
          .select('id, charge_id, amount_cents, paid_at, note')
          .eq('organization_id', organizationId)
          .order('paid_at', { ascending: false }),
      ])

      if (peopleResult.error) throw peopleResult.error
      if (chargesResult.error) throw chargesResult.error
      if (paymentsResult.error) throw paymentsResult.error

      if (isCurrent) {
        setPeople((peopleResult.data ?? []) as Person[])
        setCharges((chargesResult.data ?? []) as Charge[])
        setPayments((paymentsResult.data ?? []) as Payment[])
      }
    }

    loadFinanceData()
      .catch((error: unknown) => {
        if (isCurrent) {
          setErrorMessage(getErrorMessage(error))
        }
      })
      .finally(() => {
        if (isCurrent) {
          setIsLoading(false)
        }
      })

    return () => {
      isCurrent = false
    }
  }, [organizationId])

  async function reloadFinanceData() {
    const client = supabase
    if (!client || !organizationId) return

    setIsLoading(true)
    setErrorMessage('')
    try {
      const [peopleResult, chargesResult, paymentsResult] = await Promise.all([
        client
          .from('people')
          .select('id, name')
          .eq('organization_id', organizationId)
          .order('name'),
        client
          .from('charges')
          .select('id, person_id, description, amount_cents, due_date')
          .eq('organization_id', organizationId)
          .order('due_date'),
        client
          .from('payments')
          .select('id, charge_id, amount_cents, paid_at, note')
          .eq('organization_id', organizationId)
          .order('paid_at', { ascending: false }),
      ])

      if (peopleResult.error) throw peopleResult.error
      if (chargesResult.error) throw chargesResult.error
      if (paymentsResult.error) throw paymentsResult.error

      setPeople((peopleResult.data ?? []) as Person[])
      setCharges((chargesResult.data ?? []) as Charge[])
      setPayments((paymentsResult.data ?? []) as Payment[])
    } catch (error) {
      setErrorMessage(getErrorMessage(error))
    } finally {
      setIsLoading(false)
    }
  }

  async function handleAddPerson(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const client = supabase
    const name = personName.trim()
    if (!client || !organizationId) {
      setErrorMessage('Select an organization before adding a person.')
      return
    }
    if (name.length < 1 || name.length > 120) {
      setErrorMessage('Enter a name between 1 and 120 characters.')
      return
    }

    setErrorMessage('')
    setNotice('')
    setIsSubmitting(true)
    try {
      const { data, error } = await client
        .from('people')
        .insert({
          organization_id: organizationId,
          name,
          created_by: userId,
        })
        .select('id, name')
        .single()

      if (error) throw error
      setPeople((current) =>
        [...current, data as Person].sort((a, b) => a.name.localeCompare(b.name)),
      )
      setChargePersonId((current) => current || data.id)
      setPersonName('')
      setNotice('Person added.')
    } catch (error) {
      setErrorMessage(getErrorMessage(error))
    } finally {
      setIsSubmitting(false)
    }
  }

  async function handleAddCharge(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const client = supabase
    const description = chargeDescription.trim()
    const amountCents = amountToCents(chargeAmount)
    const selectedPersonId = people.some((person) => person.id === chargePersonId)
      ? chargePersonId
      : people[0]?.id
    if (!client || !organizationId) {
      setErrorMessage('Select an organization before adding an amount owed.')
      return
    }
    if (!selectedPersonId) {
      setErrorMessage('Choose who owes this amount.')
      return
    }
    if (description.length < 1 || description.length > 240) {
      setErrorMessage('Enter a description between 1 and 240 characters.')
      return
    }
    if (amountCents === null) {
      setErrorMessage('Enter a positive amount with no more than two decimal places.')
      return
    }
    if (!chargeDueDate) {
      setErrorMessage('Choose a due date.')
      return
    }

    setErrorMessage('')
    setNotice('')
    setIsSubmitting(true)
    try {
      const { error } = await client.from('charges').insert({
        organization_id: organizationId,
        person_id: selectedPersonId,
        description,
        amount_cents: amountCents,
        due_date: chargeDueDate,
        created_by: userId,
      })
      if (error) throw error

      setChargeDescription('')
      setChargeAmount('')
      setChargeDueDate(localDateString(new Date()))
      setNotice('Amount owed added.')
      await reloadFinanceData()
    } catch (error) {
      setErrorMessage(getErrorMessage(error))
    } finally {
      setIsSubmitting(false)
    }
  }

  async function handleRecordPayment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const client = supabase
    const amountCents = amountToCents(paymentAmount)
    if (!client || !paymentChargeId) {
      setErrorMessage('Choose an amount owed before recording a payment.')
      return
    }
    if (amountCents === null) {
      setErrorMessage('Enter a positive payment with no more than two decimal places.')
      return
    }
    if (!paymentDate) {
      setErrorMessage('Choose the payment date.')
      return
    }
    if (paymentNote.trim().length > 500) {
      setErrorMessage('Payment note must be 500 characters or fewer.')
      return
    }

    setErrorMessage('')
    setNotice('')
    setIsSubmitting(true)
    try {
      const { error } = await client.rpc('record_payment', {
        p_charge_id: paymentChargeId,
        p_amount_cents: amountCents,
        p_paid_at: paymentDate,
        p_note: paymentNote.trim() || null,
      })
      if (error) throw error

      setPaymentChargeId('')
      setPaymentAmount('')
      setPaymentDate(localDateString(new Date()))
      setPaymentNote('')
      setNotice('Payment recorded.')
      await reloadFinanceData()
    } catch (error) {
      setErrorMessage(getErrorMessage(error))
    } finally {
      setIsSubmitting(false)
    }
  }

  const organization = organizations.find((item) => item.id === organizationId)
  const personNames = new Map(people.map((person) => [person.id, person.name]))
  const remainingByCharge = new Map(
    charges.map((charge) => {
      const paid = payments
        .filter((payment) => payment.charge_id === charge.id)
        .reduce((sum, payment) => sum + Number(payment.amount_cents), 0)
      return [charge.id, Number(charge.amount_cents) - paid]
    }),
  )
  const unpaidCharges = charges.filter(
    (charge) => (remainingByCharge.get(charge.id) ?? 0) > 0,
  )

  return (
    <div className="finance-workspace">
      {organizations.length > 1 && (
        <div className="organization-picker">
          <label htmlFor="active-organization">Organization</label>
          <select
            id="active-organization"
            value={organizationId}
            disabled={isSubmitting}
            onChange={(event) => {
              setOrganizationId(event.target.value)
              setPeople([])
              setCharges([])
              setPayments([])
              setChargePersonId('')
              setPaymentChargeId('')
              setNotice('')
              setErrorMessage('')
            }}
          >
            {organizations.map((item) => (
              <option key={item.id} value={item.id}>{item.name}</option>
            ))}
          </select>
        </div>
      )}

      <div className="finance-heading">
        <div>
          <p className="eyebrow">FINANCE WORKSPACE</p>
          <h2>{organization?.name ?? 'Your organization'}</h2>
        </div>
        <span className="role-badge">{organization?.role}</span>
      </div>

      {errorMessage && (
        <p className="form-message error-message" role="alert">{errorMessage}</p>
      )}
      {notice && (
        <p className="form-message success-message" role="status">{notice}</p>
      )}

      <section className="finance-panel" aria-labelledby="people-title">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">STEP 1</p>
            <h3 id="people-title">People</h3>
          </div>
        </div>
        <form className="inline-form" onSubmit={handleAddPerson}>
          <label htmlFor="person-name">Add someone who may owe money</label>
          <div className="form-row">
            <input
              id="person-name"
              type="text"
              maxLength={120}
              required
              value={personName}
              onChange={(event) => setPersonName(event.target.value)}
              placeholder="Person or member name"
            />
            <button className="secondary-button compact-button" type="submit" disabled={isSubmitting}>
              Add person
            </button>
          </div>
        </form>
        {people.length > 0 && (
          <p className="list-summary">{people.length} {people.length === 1 ? 'person' : 'people'} added</p>
        )}
      </section>

      <section className="finance-panel" aria-labelledby="charge-title">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">STEP 2</p>
            <h3 id="charge-title">Amounts owed</h3>
          </div>
        </div>
        {people.length === 0 ? (
          <p className="muted">Add a person first, then you can record an amount owed.</p>
        ) : (
          <form className="auth-form finance-form" onSubmit={handleAddCharge}>
            <label htmlFor="charge-person">Who owes this?</label>
            <select
              id="charge-person"
              value={chargePersonId || people[0]?.id || ''}
              onChange={(event) => setChargePersonId(event.target.value)}
              required
            >
              {people.map((person) => (
                <option key={person.id} value={person.id}>{person.name}</option>
              ))}
            </select>

            <label htmlFor="charge-description">Description</label>
            <input
              id="charge-description"
              type="text"
              maxLength={240}
              required
              value={chargeDescription}
              onChange={(event) => setChargeDescription(event.target.value)}
              placeholder="e.g. Monthly membership dues"
            />

            <div className="form-row">
              <div className="form-field">
                <label htmlFor="charge-amount">Amount (up to 2 decimals)</label>
                <input
                  id="charge-amount"
                  type="number"
                  min="0.01"
                  step="0.01"
                  required
                  value={chargeAmount}
                  onChange={(event) => setChargeAmount(event.target.value)}
                  placeholder="0.00"
                />
              </div>
              <div className="form-field">
                <label htmlFor="charge-due-date">Due date</label>
                <input
                  id="charge-due-date"
                  type="date"
                  required
                  value={chargeDueDate}
                  onChange={(event) => setChargeDueDate(event.target.value)}
                />
              </div>
            </div>
            <button className="primary-button" type="submit" disabled={isSubmitting}>
              {isSubmitting ? 'Saving…' : 'Add amount owed'}
            </button>
          </form>
        )}
      </section>

      <section className="finance-panel" aria-labelledby="payments-title">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">STEP 3</p>
            <h3 id="payments-title">Payments and balances</h3>
          </div>
        </div>

        {isLoading ? (
          <p className="loading-message" role="status">Loading finance records…</p>
        ) : charges.length === 0 ? (
          <p className="muted">Your amounts owed and payment balances will appear here.</p>
        ) : (
          <div className="charge-list">
            {charges.map((charge) => {
              const remaining = remainingByCharge.get(charge.id) ?? Number(charge.amount_cents)
              const chargePayments = payments.filter(
                (payment) => payment.charge_id === charge.id,
              )
              return (
                <article className="charge-card" key={charge.id}>
                  <div className="charge-card-heading">
                    <div>
                      <p className="charge-person">
                        {personNames.get(charge.person_id) ?? 'Unknown person'}
                      </p>
                      <h4>{charge.description}</h4>
                    </div>
                    <span className={remaining === 0 ? 'balance-badge paid' : 'balance-badge'}>
                      {remaining === 0 ? 'Paid' : 'Balance'}
                    </span>
                  </div>
                  <dl className="charge-details">
                    <div><dt>Owed</dt><dd>{formatAmount(charge.amount_cents)}</dd></div>
                    <div><dt>Paid</dt><dd>{formatAmount(Number(charge.amount_cents) - remaining)}</dd></div>
                    <div><dt>Remaining</dt><dd>{formatAmount(remaining)}</dd></div>
                    <div><dt>Due</dt><dd>{charge.due_date}</dd></div>
                  </dl>

                  {chargePayments.length > 0 && (
                    <details className="payment-history">
                      <summary>
                        {chargePayments.length} {chargePayments.length === 1 ? 'payment' : 'payments'}
                      </summary>
                      <ul>
                        {chargePayments.map((payment) => (
                          <li key={payment.id}>
                            <span>{payment.paid_at}{payment.note ? ` · ${payment.note}` : ''}</span>
                            <strong>{formatAmount(payment.amount_cents)}</strong>
                          </li>
                        ))}
                      </ul>
                    </details>
                  )}

                  {remaining > 0 && (
                    <button
                      className="text-button"
                      type="button"
                      onClick={() => {
                        setPaymentChargeId((current) => current === charge.id ? '' : charge.id)
                        setPaymentAmount('')
                        setErrorMessage('')
                        setNotice('')
                      }}
                    >
                      {paymentChargeId === charge.id ? 'Cancel payment' : 'Record a payment'}
                    </button>
                  )}

                  {paymentChargeId === charge.id && remaining > 0 && (
                    <form className="payment-form" onSubmit={handleRecordPayment}>
                      <label htmlFor={`payment-amount-${charge.id}`}>Payment amount</label>
                      <div className="form-row">
                        <input
                          id={`payment-amount-${charge.id}`}
                          type="number"
                          min="0.01"
                          max={(remaining / 100).toFixed(2)}
                          step="0.01"
                          required
                          value={paymentAmount}
                          onChange={(event) => setPaymentAmount(event.target.value)}
                          placeholder="0.00"
                        />
                        <input
                          aria-label="Payment date"
                          type="date"
                          required
                          value={paymentDate}
                          onChange={(event) => setPaymentDate(event.target.value)}
                        />
                      </div>
                      <label htmlFor={`payment-note-${charge.id}`}>Note (optional)</label>
                      <input
                        id={`payment-note-${charge.id}`}
                        type="text"
                        maxLength={500}
                        value={paymentNote}
                        onChange={(event) => setPaymentNote(event.target.value)}
                        placeholder="Optional reference"
                      />
                      <button className="primary-button" type="submit" disabled={isSubmitting}>
                        {isSubmitting ? 'Recording…' : 'Save payment'}
                      </button>
                    </form>
                  )}
                </article>
              )
            })}
          </div>
        )}
        {unpaidCharges.length === 0 && charges.length > 0 && !isLoading && (
          <p className="all-paid-note">All recorded amounts are paid in full.</p>
        )}
      </section>
    </div>
  )
}
