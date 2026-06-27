import { useState } from 'react'
import { useApp } from '../state/AppState'
import { PitchBackground } from './PitchBackground'

export function Login() {
  const { login, signup, loginError, authPending } = useApp()
  const [mode, setMode] = useState<'signin' | 'signup'>('signin')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [notice, setNotice] = useState<string | null>(null)

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setNotice(null)
    if (mode === 'signin') {
      const res = await login(username, password)
      if (!res.ok && res.needsSignup) {
        setMode('signup')
        setNotice('No account found with that name and pass code. Create one below.')
      }
    } else {
      const res = await signup(username, password)
      if (!res.ok && res.error?.toLowerCase().includes('taken')) {
        setMode('signin')
        setNotice('That name already exists — sign in instead.')
      }
    }
  }

  function switchMode(next: 'signin' | 'signup') {
    setMode(next)
    setNotice(null)
  }

  const isSignup = mode === 'signup'

  return (
    <div className="login login--game">
      <PitchBackground variant="menu" />
      <div className="login__scrim" />

      <div className="login__stage">
        <span className="login__emblem" aria-hidden>
          <svg viewBox="0 0 64 64" width="40" height="40">
            <circle cx="32" cy="32" r="27" fill="none" stroke="rgba(255,222,160,0.85)" strokeWidth="2" />
            <polygon points="32,18 41,25 37,36 27,36 23,25" fill="rgba(255,222,160,0.85)" />
            <path d="M32 5 L32 12 M32 52 L32 59 M5 32 L12 32 M52 32 L59 32"
              stroke="rgba(255,222,160,0.55)" strokeWidth="2" strokeLinecap="round" />
          </svg>
        </span>
        <span className="login__kicker">Intro Physics · Season 1</span>
        <h1 className="login__title">PHYSICS FC</h1>

        <div className="login__rule" aria-hidden>
          <span /><i /><span />
        </div>

        <p className="login__tag">Master the laws of motion. Win the match.</p>

        <form className="login__form" onSubmit={onSubmit}>
          <div className="login__field">
            <label htmlFor="login-name">Player name</label>
            <input
              id="login-name"
              className="login__input"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="Enter your name"
              autoComplete="username"
              autoFocus
            />
          </div>
          <div className="login__field">
            <label htmlFor="login-pass">Pass code</label>
            <input
              id="login-pass"
              className="login__input"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={isSignup ? 'Choose a pass code (4+ chars)' : 'Enter pass code'}
              autoComplete={isSignup ? 'new-password' : 'current-password'}
            />
          </div>

          {notice && <p className="login__notice" role="status">{notice}</p>}
          {loginError && <p className="field-error" role="alert">{loginError}</p>}

          <button type="submit" className="login__enter" disabled={authPending}>
            <span>{authPending ? 'Loading…' : isSignup ? 'Create Account' : 'Kick Off'}</span>
          </button>

          <p className="login__switch">
            {isSignup ? (
              <>
                Already have a squad?{' '}
                <button type="button" onClick={() => switchMode('signin')}>Sign in</button>
              </>
            ) : (
              <>
                New here?{' '}
                <button type="button" onClick={() => switchMode('signup')}>Create an account</button>
              </>
            )}
          </p>
        </form>
      </div>

      <div className="login__footer">
        <span className="login__server">Season 1 · Global Server</span>
      </div>
    </div>
  )
}
