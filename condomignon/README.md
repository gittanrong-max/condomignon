# Condomignon

A React + TypeScript starter for the customer-facing finance app. The first
feature is email/password account creation and sign-in using Supabase Auth.

## Run locally

1. Create a Supabase project.
2. Copy `.env.example` to `.env.local`.
3. Set `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` from the
   Supabase project settings.
4. In Supabase Authentication settings, enable email/password sign-in and add
   your local app URL (for example, `http://localhost:5173`) to the allowed
   redirect URLs.
5. Install dependencies and start the dev server:

   ```sh
   npm install
   npm run dev
   ```

By default, Supabase may require email confirmation before a new account can
sign in. The app displays a message asking the user to check their email.

After signing in, a user can create an organization. This flow expects the
`organizations` and `organization_members` tables, their Row Level Security
policies, and the `create_organization(text)` RPC to be installed in Supabase.
Run the organization setup SQL in the Supabase SQL Editor before testing this
feature. The RPC creates the organization and its owner membership together;
the app then reads memberships and organizations through the user's session.

Only the Supabase publishable key belongs in frontend configuration. Never put
the secret or service-role key in this app. Before adding customer data, enable
and test Row Level Security policies for every database table.
