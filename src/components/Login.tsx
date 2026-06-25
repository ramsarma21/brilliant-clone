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
        <h1>Physics you can play with.</h1>
        <p>Interactive simulations for introductory college physics.</p>
        <div className="login__chips">
          <span className="subject-chip">Projectiles</span>
          <span className="subject-chip">Graphs</span>
          <span className="subject-chip">Forces</span>
          <span className="subject-chip">Energy</span>
          <span className="subject-chip">Circuits</span>
        </div>
      </div>

      <form className="login__card" onSubmit={onSubmit}>
        <div className="login__card-inner">
          <h2>Welcome back</h2>
          <p className="muted">Sign in to continue.</p>

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
            Sign in
          </button>
          <p className="login__hint muted">Demo account · <strong>test</strong> / <strong>test</strong></p>
        </div>
      </form>
    </div>
  )
}
