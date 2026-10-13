import { useEffect, useState, type FormEvent } from 'react'
import { ArrowRight, Command, LockKeyhole, Mail } from 'lucide-react'
import { apiRequest } from './api'

type Invitation = {
  email: string
  role: 'admin' | 'member'
  organizationName: string
  expiresAt: string
}

type Props = {
  busyMessage: string
  onLogin: (email: string, password: string) => Promise<void>
  onRegister: (input: { email: string; password: string; displayName: string; organizationName: string }) => Promise<void>
  onAcceptInvitation: (input: { token: string; displayName: string; password?: string }) => Promise<void>
}

type AuthMode = 'login' | 'register' | 'invite'

export function AuthScreen({ busyMessage, onLogin, onRegister, onAcceptInvitation }: Props) {
  const invitationToken = new URLSearchParams(window.location.search).get('token') ?? ''
  const [mode, setMode] = useState<AuthMode>(invitationToken ? 'invite' : 'login')
  const [invitation, setInvitation] = useState<Invitation | null>(null)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [organizationName, setOrganizationName] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!invitationToken) return
    apiRequest<Invitation>(`/api/invitations/inspect?token=${encodeURIComponent(invitationToken)}`)
      .then((result) => {
        setInvitation(result)
        setEmail(result.email)
      })
      .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : 'This invitation is not available.'))
  }, [invitationToken])

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setError('')
    setSubmitting(true)
    try {
      if (mode === 'login') {
        await onLogin(email, password)
        if (invitationToken) await onAcceptInvitation({ token: invitationToken, displayName: displayName || email.split('@')[0] })
        return
      }
      if (mode === 'register') {
        await onRegister({ email, password, displayName, organizationName })
        return
      }
      await onAcceptInvitation({ token: invitationToken, displayName, password })
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The request could not be completed.')
    } finally {
      setSubmitting(false)
    }
  }

  const title = mode === 'invite'
    ? 'Join your team'
    : mode === 'register'
      ? 'Create your workspace'
      : 'Welcome back'
  const subtitle = mode === 'invite' && invitation
    ? `${invitation.email} was invited to join ${invitation.organizationName}.`
    : mode === 'register'
      ? 'Set up your account and organization to get started.'
      : 'Sign in to your project workspace.'

  return (
    <main className="auth-page">
      <section className="auth-card">
        <a className="brand auth-brand" href="/" aria-label="Kanban Studio home">
          <span className="brand-mark"><Command size={17} strokeWidth={2.5} /></span>
          <span>stride<span className="brand-period">.</span></span>
        </a>
        <span className="dialog-kicker">KANBAN STUDIO</span>
        <h1>{title}</h1>
        <p className="auth-subtitle">{subtitle}</p>

        {mode === 'invite' && invitation && (
          <div className="invite-role-note">Invited as an organization {invitation.role}. This link expires {new Date(invitation.expiresAt).toLocaleString()}.</div>
        )}

        <form className="auth-form" onSubmit={submit}>
          {mode !== 'login' && (
            <label className="auth-field">Your name
              <input autoComplete="name" required minLength={1} maxLength={100} value={displayName} onChange={(event) => setDisplayName(event.target.value)} placeholder="e.g. Alex Morgan" />
            </label>
          )}
          <label className="auth-field">Email address
            <span className="auth-input-wrap"><Mail size={15} /><input autoComplete="email" required type="email" maxLength={254} value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@company.com" readOnly={mode === 'invite' || Boolean(invitationToken)} /></span>
          </label>
          {mode === 'register' && (
            <label className="auth-field">Organization name
              <input required minLength={1} maxLength={100} value={organizationName} onChange={(event) => setOrganizationName(event.target.value)} placeholder="e.g. Studio North" />
              <span className="auth-field-hint">You’ll become the owner and can invite teammates.</span>
            </label>
          )}
          {!(mode === 'login' && invitationToken) && (
            <label className="auth-field">Password
              <span className="auth-input-wrap"><LockKeyhole size={15} /><input autoComplete={mode === 'login' ? 'current-password' : 'new-password'} required type="password" minLength={mode === 'login' ? 1 : 12} maxLength={128} value={password} onChange={(event) => setPassword(event.target.value)} placeholder={mode === 'login' ? 'Your password' : 'At least 12 characters'} /></span>
            </label>
          )}
          {error && <p className="auth-error" role="alert">{error}</p>}
          <button className="button button-primary auth-submit" type="submit" disabled={submitting || (mode === 'invite' && !invitation)}>
            {submitting ? 'Please wait…' : mode === 'login' ? invitationToken ? 'Sign in and accept invite' : 'Sign in' : mode === 'register' ? 'Create organization' : 'Accept invitation'}
            {!submitting && <ArrowRight size={15} />}
          </button>
        </form>
        {mode !== 'invite' && (
          <div className="auth-mode-switch">
            {mode === 'login' ? 'New to Kanban Studio?' : 'Already have an account?'}
            <button type="button" onClick={() => { setError(''); setPassword(''); setMode(mode === 'login' ? 'register' : 'login') }}>
              {mode === 'login' ? 'Create an organization' : 'Sign in'}
            </button>
          </div>
        )}
        {mode === 'invite' && (
          <div className="auth-mode-switch">
            Already have an account?
            <button type="button" onClick={() => { setError(''); setPassword(''); setMode('login') }}>Sign in to accept</button>
          </div>
        )}
        <p className="auth-demo-note">{busyMessage || 'Your account is private to your organization. Data is stored in a shared SQL database.'}</p>
      </section>
    </main>
  )
}
