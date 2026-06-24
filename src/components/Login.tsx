import { useState } from 'react'
import { useApp } from '../state/AppState'

export function Login() {
  const { login, loginError } = useApp()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')

  function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    login(username, password)
  }

  return (
    <div className="login">
      <div className="login__hero">
        <div className="login__orb login__orb--a" />
        <div className="login__orb login__orb--b" />
        <span className="brand brand--light">
          <span className="brand__mark">⚡</span> Physics&nbsp;Lab
        </span>
        <h1>Learn college physics by experimenting.</h1>
        <p>
          Five interactive Physics I units — projectiles, motion graphs, forces, energy, and
          circuits. Predict, manipulate, observe, and get instant feedback.
        </p>
        <div className="login__chips">
          <span className="subject-chip">🚀 Projectiles</span>
          <span className="subject-chip">📈 Graphs</span>
          <span className="subject-chip">📦 Forces</span>
          <span className="subject-chip">⚡ Energy</span>
          <span className="subject-chip">💡 Circuits</span>
        </div>
        <ul className="login__points">
          <li>Hands-on simulations, not videos</li>
          <li>Instant, specific feedback</li>
          <li>Progress and streaks that save automatically</li>
        </ul>
      </div>

      <form className="login__card" onSubmit={onSubmit}>
        <div className="login__card-inner">
          <h2>Demo login</h2>
          <p className="muted">Use the demo credentials to explore the full course.</p>

          <label className="field">
            <span>Username</span>
            <input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="test"
              autoComplete="username"
              autoFocus
            />
          </label>
          <label className="field">
            <span>Password</span>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="test"
              autoComplete="current-password"
            />
          </label>

          {loginError && <p className="field-error" role="alert">{loginError}</p>}

          <button type="submit" className="btn btn--primary btn--block">
            Log in
          </button>
          <p className="login__hint muted">Credentials: test / test</p>
        </div>
      </form>
    </div>
  )
}
