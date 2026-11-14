import { useEffect, useRef, useState, type FormEvent } from 'react'
import type { User } from '@supabase/supabase-js'
import FinanceWorkspace from './FinanceWorkspace'
import { isSupabaseConfigured, supabase } from './supabase'

type AuthMode = 'sign-in' | 'sign-up'
type OrganizationAccess = {
  id: string
  name: string
  role: string
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error
    ? error.message
    : 'Something went wrong. Please try again.'
}

async function getOrganizationsForUser(
  client: NonNullable<typeof supabase>,
  userId: string,
): Promise<OrganizationAccess[]> {
  const { data: memberships, error: membershipsError } = await client
    .from('organization_members')
    .select('organization_id, role')
    .eq('user_id', userId)

  if (membershipsError) {
    throw membershipsError
  }

  if (memberships.length === 0) {
    return []
  }

  const organizationIds = memberships.map(
    (membership) => membership.organization_id,
  )
  const { data: organizations, error: organizationsError } = await client
    .from('organizations')
    .select('id, name')
    .in('id', organizationIds)

  if (organizationsError) {
    throw organizationsError
  }

  const organizationsById = new Map(
    organizations.map((organization) => [organization.id, organization.name]),
  )

  return memberships.map((membership) => {
    const name = organizationsById.get(membership.organization_id)
    if (!name) {
      throw new Error('A membership was found, but its organization could not be loaded.')
    }

    return {
      id: membership.organization_id,
      name,
      role: membership.role,
    }
  })
}

export default function App() {
  const [user, setUser] = useState<User | null>(null)
  const [mode, setMode] = useState<AuthMode>('sign-up')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [organizationName, setOrganizationName] = useState('')
  const [organizations, setOrganizations] = useState<OrganizationAccess[]>([])
  const [notice, setNotice] = useState('')
  const [errorMessage, setErrorMessage] = useState('')
  const [organizationError, setOrganizationError] = useState('')
  const [isLoading, setIsLoading] = useState(true)
  const [isLoadingOrganizations, setIsLoadingOrganizations] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const activeUserId = useRef<string | null>(null)

  useEffect(() => {
    if (!supabase) {
      setIsLoading(false)
      return
    }

    let isMounted = true
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (isMounted) {
        const nextUserId = session?.user.id ?? null
        if (activeUserId.current !== nextUserId) {
          activeUserId.current = nextUserId
          setOrganizations([])
          setOrganizationError('')
          setIsLoadingOrganizations(nextUserId !== null)
        }
        setUser(session?.user ?? null)
        setIsLoading(false)
      }
    })

    return () => {
      isMounted = false
      subscription.unsubscribe()
    }
  }, [])

  useEffect(() => {
    if (!user || !supabase) {
      setOrganizations([])
      setOrganizationError('')
      setIsLoadingOrganizations(false)
      return
    }

    let isCurrent = true
    setIsLoadingOrganizations(true)
    setOrganizationError('')

    getOrganizationsForUser(supabase, user.id)
      .then((memberships) => {
        if (isCurrent) {
          setOrganizations(memberships)
        }
      })
      .catch((error: unknown) => {
        if (isCurrent) {
          setOrganizationError(getErrorMessage(error))
        }
      })
      .finally(() => {
        if (isCurrent) {
          setIsLoadingOrganizations(false)
        }
      })

    return () => {
      isCurrent = false
    }
  }, [user])

  function changeMode(nextMode: AuthMode) {
    setMode(nextMode)
    setNotice('')
    setErrorMessage('')
  }

  async function handleCreateOrganization(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setNotice('')
    setOrganizationError('')

    if (!supabase || !user) {
      setOrganizationError('Sign in before creating an organization.')
      return
    }

    const cleanName = organizationName.trim()
    if (cleanName.length < 1 || cleanName.length > 120) {
      setOrganizationError('Enter an organization name between 1 and 120 characters.')
      return
    }

    setIsSubmitting(true)
    try {
      const { error } = await supabase.rpc('create_organization', {
        organization_name: cleanName,
      })

      if (error) {
        throw error
      }

      setOrganizationName('')
      const memberships = await getOrganizationsForUser(supabase, user.id)
      setOrganizations(memberships)
      setNotice('Your organization has been created.')
    } catch (error) {
      setOrganizationError(getErrorMessage(error))
    } finally {
      setIsSubmitting(false)
    }
  }

  async function handleReloadOrganizations() {
    if (!supabase || !user) {
      return
    }

    setOrganizationError('')
    setIsLoadingOrganizations(true)
    try {
      const memberships = await getOrganizationsForUser(supabase, user.id)
      setOrganizations(memberships)
    } catch (error) {
      setOrganizationError(getErrorMessage(error))
    } finally {
      setIsLoadingOrganizations(false)
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setNotice('')
    setErrorMessage('')

    if (!supabase) {
      setErrorMessage('Supabase is not configured. Add your project settings to .env.local.')
      return
    }

    if (mode === 'sign-up' && password !== confirmPassword) {
      setErrorMessage('The passwords do not match.')
      return
    }

    setIsSubmitting(true)
    try {
      if (mode === 'sign-up') {
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            emailRedirectTo: window.location.origin,
          },
        })

        if (error) {
          setErrorMessage(error.message)
        } else if (data.session) {
          setNotice('Your account is ready.')
        } else {
          setNotice('Check your email for a confirmation link to finish creating your account.')
        }
      } else {
        const { error } = await supabase.auth.signInWithPassword({
          email,
          password,
        })

        if (error) {
          setErrorMessage(error.message)
        }
      }
    } catch (error) {
      setErrorMessage(getErrorMessage(error))
    } finally {
      setIsSubmitting(false)
    }
  }

  async function handleSignOut() {
    if (!supabase) {
      setErrorMessage('Supabase is not configured.')
      return
    }

    setErrorMessage('')
    setNotice('')
    setIsSubmitting(true)
    try {
      const { error } = await supabase.auth.signOut()
      if (error) {
        setErrorMessage(error.message)
      }
    } catch (error) {
      setErrorMessage(getErrorMessage(error))
    } finally {
      setIsSubmitting(false)
    }
  }

  const isSignUp = mode === 'sign-up'

  return (
    <main className="page-shell">
      <header className="brand">
        <span className="brand-mark" aria-hidden="true">c</span>
        <span>condomignon</span>
      </header>

      <section className="auth-card" aria-labelledby="page-title">
        {!isSupabaseConfigured ? (
          <div className="setup-notice" role="status">
            <h1 id="page-title">Connect your Supabase project</h1>
            <p>
              Copy <code>.env.example</code> to <code>.env.local</code>, then add
              your project URL and publishable key.
            </p>
          </div>
        ) : isLoading ? (
          <p className="loading-message" role="status">Loading your account…</p>
        ) : user ? (
          <div className="account-view">
            <p className="eyebrow">YOUR ACCOUNT</p>
            <h1 id="page-title">You’re signed in</h1>
            <p className="account-email">{user.email}</p>
            <div className="organization-section">
              <div className="section-divider" />
              {isLoadingOrganizations ? (
                <p className="loading-message" role="status">
                  Loading your organizations…
                </p>
              ) : organizationError ? (
                <div>
                  <p className="form-message error-message" role="alert">
                    Could not load your organizations: {organizationError}
                  </p>
                  <button
                    className="secondary-button retry-button"
                    type="button"
                    onClick={handleReloadOrganizations}
                  >
                    Try again
                  </button>
                </div>
              ) : organizations.length > 0 ? (
                <FinanceWorkspace key={user.id} organizations={organizations} userId={user.id} />
              ) : (
                <div>
                  <div className="card-heading organization-heading">
                    <p className="eyebrow">GET STARTED</p>
                    <h2 id="organization-title">Create your organization</h2>
                    <p className="muted">
                      This will create an organization and make your account its owner.
                    </p>
                  </div>
                  <form
                    className="auth-form"
                    aria-labelledby="organization-title"
                    onSubmit={handleCreateOrganization}
                  >
                    <label htmlFor="organization-name">Organization name</label>
                    <input
                      id="organization-name"
                      name="organization-name"
                      type="text"
                      autoComplete="organization"
                      maxLength={120}
                      required
                      value={organizationName}
                      onChange={(event) => setOrganizationName(event.target.value)}
                      placeholder="e.g. Northside Community Group"
                    />
                    {organizationError && (
                      <p className="form-message error-message" role="alert">
                        {organizationError}
                      </p>
                    )}
                    {notice && (
                      <p className="form-message success-message" role="status">
                        {notice}
                      </p>
                    )}
                    <button
                      className="primary-button"
                      type="submit"
                      disabled={isSubmitting}
                    >
                      {isSubmitting ? 'Creating organization…' : 'Create organization'}
                    </button>
                  </form>
                </div>
              )}
            </div>
            <button
              className="secondary-button"
              type="button"
              onClick={handleSignOut}
              disabled={isSubmitting}
            >
              {isSubmitting ? 'Signing out…' : 'Sign out'}
            </button>
          </div>
        ) : (
          <>
            <div className="card-heading">
              <p className="eyebrow">A clearer way to manage money</p>
              <h1 id="page-title">{isSignUp ? 'Create your account' : 'Welcome back'}</h1>
              <p className="muted">
                {isSignUp
                  ? 'Start with a secure account for your organization.'
                  : 'Sign in to continue to your account.'}
              </p>
            </div>

            <div className="mode-switch" aria-label="Account action">
              <button
                type="button"
                className={isSignUp ? 'mode-button active' : 'mode-button'}
                aria-pressed={isSignUp}
                onClick={() => changeMode('sign-up')}
              >
                Create account
              </button>
              <button
                type="button"
                className={!isSignUp ? 'mode-button active' : 'mode-button'}
                aria-pressed={!isSignUp}
                onClick={() => changeMode('sign-in')}
              >
                Sign in
              </button>
            </div>

            <form className="auth-form" onSubmit={handleSubmit}>
              <label htmlFor="email">Email address</label>
              <input
                id="email"
                name="email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="you@example.com"
              />

              <label htmlFor="password">Password</label>
              <input
                id="password"
                name="password"
                type="password"
                autoComplete={isSignUp ? 'new-password' : 'current-password'}
                minLength={8}
                required
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="At least 8 characters"
              />

              {isSignUp && (
                <>
                  <label htmlFor="confirm-password">Confirm password</label>
                  <input
                    id="confirm-password"
                    name="confirm-password"
                    type="password"
                    autoComplete="new-password"
                    minLength={8}
                    required
                    value={confirmPassword}
                    onChange={(event) => setConfirmPassword(event.target.value)}
                    placeholder="Enter your password again"
                  />
                </>
              )}

              {errorMessage && (
                <p className="form-message error-message" role="alert">
                  {errorMessage}
                </p>
              )}
              {notice && (
                <p className="form-message success-message" role="status">
                  {notice}
                </p>
              )}

              <button className="primary-button" type="submit" disabled={isSubmitting}>
                {isSubmitting
                  ? 'Please wait…'
                  : isSignUp
                    ? 'Create account'
                    : 'Sign in'}
              </button>
            </form>

            <p className="privacy-note">
              Your password is handled by Supabase Authentication and is not
              saved in this app’s finance database.
            </p>
          </>
        )}
      </section>
      <footer>Simple finance tools for small organizations.</footer>
    </main>
  )
}
