// Tiny procedural Web Audio SFX. No assets; everything is synthesised so it stays
// lightweight and bundle-free. All calls are fail-safe (silent if audio is blocked).

let ctx: AudioContext | null = null
let enabled = true

// User mute preference, persisted across sessions. Independent of `enabled`
// (which only flips to false if the browser blocks audio entirely).
const MUTE_KEY = 'physics:sfx-muted'
let muted = (() => {
  try {
    return localStorage.getItem(MUTE_KEY) === '1'
  } catch {
    return false
  }
})()

export function isMuted(): boolean {
  return muted
}

/** Toggle (or explicitly set) mute. Returns the new muted state. Persisted. */
export function setMuted(next?: boolean): boolean {
  muted = next ?? !muted
  try {
    localStorage.setItem(MUTE_KEY, muted ? '1' : '0')
  } catch {
    /* ignore */
  }
  return muted
}

function ac(): AudioContext | null {
  if (!enabled || muted) return null
  try {
    if (!ctx) {
      const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
      ctx = new Ctor()
    }
    if (ctx.state === 'suspended') void ctx.resume()
    return ctx
  } catch {
    enabled = false
    return null
  }
}

/** Call from a user gesture (keydown/click) so the browser unlocks audio. */
export function unlockAudio(): void {
  ac()
}

function tone(freq: number, dur: number, type: OscillatorType, gain: number, delay = 0): void {
  const a = ac()
  if (!a) return
  const t = a.currentTime + delay
  const osc = a.createOscillator()
  const g = a.createGain()
  osc.type = type
  osc.frequency.setValueAtTime(freq, t)
  g.gain.setValueAtTime(0, t)
  g.gain.linearRampToValueAtTime(gain, t + 0.008)
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur)
  osc.connect(g).connect(a.destination)
  osc.start(t)
  osc.stop(t + dur + 0.02)
}

/** A short, dull "thock" on every kick. */
export function sfxKick(): void {
  tone(190, 0.1, 'triangle', 0.09)
  tone(95, 0.12, 'sine', 0.06)
}

/** Two-tone referee whistle (kickoff / full time). */
export function sfxWhistle(): void {
  tone(2100, 0.16, 'square', 0.05)
  tone(2400, 0.22, 'square', 0.05, 0.18)
}

/** A rising filtered-noise crowd swell for goals. */
export function sfxCheer(): void {
  const a = ac()
  if (!a) return
  const t = a.currentTime
  const buffer = a.createBuffer(1, a.sampleRate * 1.4, a.sampleRate)
  const data = buffer.getChannelData(0)
  for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * 0.6
  const src = a.createBufferSource()
  src.buffer = buffer
  const bp = a.createBiquadFilter()
  bp.type = 'bandpass'
  bp.frequency.setValueAtTime(500, t)
  bp.frequency.linearRampToValueAtTime(1400, t + 0.7)
  bp.Q.value = 0.8
  const g = a.createGain()
  g.gain.setValueAtTime(0, t)
  g.gain.linearRampToValueAtTime(0.2, t + 0.25)
  g.gain.linearRampToValueAtTime(0.14, t + 0.8)
  g.gain.exponentialRampToValueAtTime(0.0001, t + 1.4)
  src.connect(bp).connect(g).connect(a.destination)
  src.start(t)
  src.stop(t + 1.4)
  // a couple of celebratory toots
  tone(880, 0.18, 'square', 0.05, 0.05)
  tone(1175, 0.2, 'square', 0.05, 0.22)
}

// ===========================================================================
// UI / economy SFX — the audio half of the "juice" layer. All synthesised,
// all fail-safe. Tuned to be short and satisfying, never grating.
// ===========================================================================

/** Bright coin "clink" — used on each coin tick / small reward. */
export function sfxCoin(): void {
  tone(1320, 0.07, 'triangle', 0.06)
  tone(1980, 0.09, 'sine', 0.04, 0.02)
}

/** A small rising arpeggio "cash" — the payout landing in the wallet. */
export function sfxCash(): void {
  tone(880, 0.09, 'triangle', 0.06, 0)
  tone(1175, 0.09, 'triangle', 0.06, 0.07)
  tone(1568, 0.14, 'triangle', 0.06, 0.14)
  tone(2349, 0.18, 'sine', 0.05, 0.22)
}

/** Streak-up whoosh — a quick upward sweep as the flame grows. */
export function sfxStreakUp(): void {
  const a = ac()
  if (!a) return
  const t = a.currentTime
  const osc = a.createOscillator()
  const g = a.createGain()
  osc.type = 'sawtooth'
  osc.frequency.setValueAtTime(420, t)
  osc.frequency.exponentialRampToValueAtTime(1400, t + 0.22)
  g.gain.setValueAtTime(0, t)
  g.gain.linearRampToValueAtTime(0.05, t + 0.03)
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.3)
  osc.connect(g).connect(a.destination)
  osc.start(t)
  osc.stop(t + 0.32)
}

/** Soft, non-punishing "fresh run" tone for a missed run — gentle, not a buzzer. */
export function sfxSoftFail(): void {
  tone(440, 0.16, 'sine', 0.05, 0)
  tone(330, 0.22, 'sine', 0.045, 0.12)
}

/** A subtle UI tick for button presses / selections. */
export function sfxTick(): void {
  tone(660, 0.04, 'square', 0.03)
}

/** A short countdown tick — used when the per-question timer is in the danger zone. */
export function sfxCountdown(): void {
  tone(880, 0.05, 'square', 0.035)
}

/** Triumphant fanfare for the perfect-run / bonus-spin reveal — the big moment. */
export function sfxFanfare(): void {
  tone(523, 0.12, 'triangle', 0.06, 0)
  tone(659, 0.12, 'triangle', 0.06, 0.1)
  tone(784, 0.14, 'triangle', 0.06, 0.2)
  tone(1047, 0.28, 'triangle', 0.07, 0.32)
  tone(1568, 0.3, 'sine', 0.05, 0.36)
}
