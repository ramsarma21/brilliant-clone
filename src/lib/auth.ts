import { getSupabase, isSupabaseConfigured } from './supabase'

export type AuthProfile = { id: string; username: string; displayName: string }

export type AuthResult =
  | { ok: true; profile: AuthProfile }
  | {
      ok: false
      reason: 'no-account' | 'username-taken' | 'weak-password' | 'error'
      message: string
    }

const LOCAL_ACCOUNTS_KEY = 'physics-accounts'

type LocalAccount = { id: string; username: string; password: string; displayName: string }

function newId(): string {
  try {
    return crypto.randomUUID()
  } catch {
    return `local-${Math.random().toString(36).slice(2)}`
  }
}

function loadLocalAccounts(): Record<string, LocalAccount> {
  try {
    const raw = localStorage.getItem(LOCAL_ACCOUNTS_KEY)
    return raw ? (JSON.parse(raw) as Record<string, LocalAccount>) : {}
  } catch {
    return {}
  }
}

function saveLocalAccounts(map: Record<string, LocalAccount>): void {
  try {
    localStorage.setItem(LOCAL_ACCOUNTS_KEY, JSON.stringify(map))
  } catch {
    // ignore storage failures (private mode, quota)
  }
}

const key = (u: string) => u.trim().toLowerCase()

function localSignup(username: string, password: string): AuthResult {
  const map = loadLocalAccounts()
  if (map[key(username)]) {
    return { ok: false, reason: 'username-taken', message: 'That name is already taken. Try signing in.' }
  }
  const acct: LocalAccount = {
    id: newId(),
    username: username.trim(),
    password,
    displayName: username.trim(),
  }
  map[key(username)] = acct
  saveLocalAccounts(map)
  return { ok: true, profile: { id: acct.id, username: acct.username, displayName: acct.displayName } }
}

function localLogin(username: string, password: string): AuthResult {
  const acct = loadLocalAccounts()[key(username)]
  if (!acct || acct.password !== password) {
    return { ok: false, reason: 'no-account', message: 'No account matches that name and pass code.' }
  }
  return { ok: true, profile: { id: acct.id, username: acct.username, displayName: acct.displayName } }
}

type RpcRow = { id: string; username: string; display_name: string | null }

function rowToProfile(row: RpcRow): AuthProfile {
  return { id: row.id, username: row.username, displayName: row.display_name ?? row.username }
}

export async function signInUser(username: string, password: string): Promise<AuthResult> {
  const u = username.trim()
  if (!u || !password) return { ok: false, reason: 'error', message: 'Enter a name and a pass code.' }

  const sb = isSupabaseConfigured ? getSupabase() : null
  if (sb) {
    try {
      const { data, error } = await sb.rpc('account_login', { p_username: u, p_password: password })
      if (error) return localLogin(u, password) // RPC not deployed / offline → degrade
      const row = (Array.isArray(data) ? data[0] : data) as RpcRow | undefined
      if (!row) return { ok: false, reason: 'no-account', message: 'No account matches that name and pass code.' }
      return { ok: true, profile: rowToProfile(row) }
    } catch {
      return localLogin(u, password)
    }
  }
  return localLogin(u, password)
}

export async function signUpUser(username: string, password: string): Promise<AuthResult> {
  const u = username.trim()
  if (!u || !password) return { ok: false, reason: 'error', message: 'Enter a name and a pass code.' }
  if (password.length < 4) {
    return { ok: false, reason: 'weak-password', message: 'Pass code must be at least 4 characters.' }
  }
  if (u.toLowerCase() === 'test') {
    return { ok: false, reason: 'username-taken', message: 'That name is reserved. Pick another.' }
  }

  const sb = isSupabaseConfigured ? getSupabase() : null
  if (sb) {
    try {
      const { data, error } = await sb.rpc('account_signup', { p_username: u, p_password: password })
      if (error) {
        const msg = error.message ?? ''
        if (msg.includes('USERNAME_TAKEN')) {
          return { ok: false, reason: 'username-taken', message: 'That name is already taken.' }
        }
        if (msg.includes('WEAK_PASSWORD')) {
          return { ok: false, reason: 'weak-password', message: 'Pass code must be at least 4 characters.' }
        }
        return localSignup(u, password) // RPC not deployed / offline → degrade
      }
      const row = (Array.isArray(data) ? data[0] : data) as RpcRow | undefined
      if (!row) return { ok: false, reason: 'error', message: 'Could not create the account. Try again.' }
      return { ok: true, profile: rowToProfile(row) }
    } catch {
      return localSignup(u, password)
    }
  }
  return localSignup(u, password)
}
