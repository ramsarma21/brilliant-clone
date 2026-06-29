import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'

export type ToastTone = 'coin' | 'go' | 'heat' | 'info'
export type Toast = { id: number; text: string; icon?: string; tone: ToastTone }

type ToastContextValue = {
  /** Show a celebratory/info toast (auto-dismisses). */
  toast: (t: { text: string; icon?: string; tone?: ToastTone; ttlMs?: number }) => void
}

const ToastContext = createContext<ToastContextValue | null>(null)

let nextId = 1

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])

  const remove = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id))
  }, [])

  const toast = useCallback<ToastContextValue['toast']>(
    ({ text, icon, tone = 'info', ttlMs = 3200 }) => {
      const id = nextId++
      setToasts((prev) => [...prev.slice(-3), { id, text, icon, tone }])
      window.setTimeout(() => remove(id), ttlMs)
    },
    [remove],
  )

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      <div className="toast-stack" aria-live="polite" aria-atomic="false">
        {toasts.map((t) => (
          <ToastItem key={t.id} toast={t} onDismiss={() => remove(t.id)} />
        ))}
      </div>
    </ToastContext.Provider>
  )
}

function ToastItem({ toast, onDismiss }: { toast: Toast; onDismiss: () => void }) {
  const [leaving, setLeaving] = useState(false)
  useEffect(() => {
    const t = window.setTimeout(() => setLeaving(true), 2900)
    return () => window.clearTimeout(t)
  }, [])
  return (
    <button
      type="button"
      className={`toast toast--${toast.tone}${leaving ? ' is-leaving' : ''}`}
      onClick={onDismiss}
    >
      {toast.icon && <span className="toast__icon" aria-hidden>{toast.icon}</span>}
      <span className="toast__text">{toast.text}</span>
    </button>
  )
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext)
  // Fail-safe: a no-op if used outside a provider (keeps callers simple).
  if (!ctx) return { toast: () => {} }
  return ctx
}
