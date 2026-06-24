type FeedbackKind = 'correct' | 'incorrect' | 'near' | 'hint'

const ICON: Record<FeedbackKind, string> = {
  correct: '✓',
  incorrect: '✕',
  near: '≈',
  hint: '💡',
}

const TITLE: Record<FeedbackKind, string> = {
  correct: 'Correct',
  incorrect: 'Not quite',
  near: 'So close',
  hint: 'Hint',
}

export function Feedback({ kind, message }: { kind: FeedbackKind; message: string }) {
  return (
    <div className={`feedback feedback--${kind}`} role="status">
      <span className="feedback__icon" aria-hidden>{ICON[kind]}</span>
      <div>
        <strong>{TITLE[kind]}</strong>
        <p>{message}</p>
      </div>
    </div>
  )
}

export type { FeedbackKind }
