import { useEffect, useState } from 'react'
import { AppProvider, useApp } from './state/AppState'
import { PlayerProvider } from './state/PlayerState'
import { ToastProvider } from './components/ui/Toast'
import { unlockAudio } from './game/sfx'
import { Login } from './components/Login'
import { Onboarding } from './components/Onboarding'
import { Dashboard } from './components/Dashboard'
import { LessonPlayer } from './components/LessonPlayer'
import { TestScreen } from './components/TestScreen'
import { BallCursor } from './components/BallCursor'
import { MatchAnimPreview } from './components/match/MatchAnimPreview'
import { MatchAnim } from './components/match/MatchAnim'
import { MatchDrillPreview } from './components/match/MatchDrillPreview'
import { SoccerSimClassic } from './components/sims/SoccerSimClassic'
import { MatchGame3D } from './game/MatchGame3D'
import { clearTestSession, loadTestSession } from './lib/storage'

const TEST_HASH = '#test'

function useHash(): string {
  const [hash, setHash] = useState(window.location.hash)
  useEffect(() => {
    const on = () => setHash(window.location.hash)
    window.addEventListener('hashchange', on)
    return () => window.removeEventListener('hashchange', on)
  }, [])
  return hash
}

function Shell() {
  const { isLoggedIn, setCurrentLesson, profile, progress, markIntroDone, progressHydrated } = useApp()
  const hash = useHash()
  const username = profile.username
  const [activeLessonId, setActiveLessonId] = useState<string | null>(null)
  const [showTest, setShowTest] = useState(false)

  // On load / after login: if the URL still points at the test AND there's a
  // saved in-progress session, resume it (this is what makes a refresh survive).
  useEffect(() => {
    if (!isLoggedIn) return
    if (window.location.hash === TEST_HASH && loadTestSession(username)) {
      setShowTest(true)
    }
  }, [isLoggedIn, username])

  // Leaving the test URL (browser Back, or manually editing the URL back to the
  // home page) abandons the assessment: drop the in-progress session entirely so
  // it's as if it was never taken, and return to the dashboard.
  useEffect(() => {
    const onHashChange = () => {
      if (window.location.hash === TEST_HASH) {
        // Dev/legacy route: the skills assessment is no longer surfaced in the UI
        // (coins come only from the Coin Farm), but stays reachable via #test.
        setShowTest(true)
      } else {
        clearTestSession(username)
        setShowTest(false)
      }
    }
    window.addEventListener('hashchange', onHashChange)
    return () => window.removeEventListener('hashchange', onHashChange)
  }, [username])

  // DEV-ONLY: behind-view animation preview harness (open with #match-anim), and a frozen
  // single-frame route (?anim=<play>&t=<0..1>) used for deterministic screenshots. Stripped
  // from production builds.
  if (import.meta.env.DEV) {
    const sp = new URLSearchParams(window.location.search)
    const frozenAnim = sp.get('anim')
    if (frozenAnim) {
      return (
        <div className="matchgame"><div className="matchgame__panel">
          <div className="matchgame__pitch" aria-hidden />
          <div className="manim">
            <MatchAnim play={frozenAnim as never} teamColor="#2f6df0" oppColor="#ef4444" frozenT={Number(sp.get('t') ?? '0.5')} />
          </div>
        </div></div>
      )
    }
    if (hash === '#match-anim') return <MatchAnimPreview />
    if (hash === '#match-drill') return <MatchDrillPreview />
    // DEV-ONLY: launch the 3D FIFA-style match standalone for testing.
    if (hash === '#game3d') {
      return (
        <MatchGame3D
          matchday={7}
          playerName="Physics FC"
          playerAbbr="PHY"
          playerColors={{ primary: '#1e6fff', secondary: '#0a2a66', accent: '#ffd23f' }}
          opponentName="Quantum United"
          playerIsHome
          appearance={{ skin: 'tan', hair: 'black', hairStyle: 'short' }}
          onFinish={() => { window.location.hash = '' }}
          onExit={() => { window.location.hash = '' }}
        />
      )
    }
    // ARCHIVED: the original first-person free-dribble-and-shoot prototype (SoccerSim from
    // the MVP commit), restored standalone so it stays playable for reference.
    if (hash === '#soccer-classic') {
      return (
        <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', background: '#0a1022', padding: 24 }}>
          <div style={{ width: 'min(960px, 96vw)' }}>
            <SoccerSimClassic />
          </div>
        </div>
      )
    }
  }

  if (!isLoggedIn) return <Login />

  // Wait for the player's saved progress to hydrate (device cache or cloud) before deciding
  // whether to play the intro, so a returning player on a fresh device never re-sees it.
  if (!progressHydrated) {
    return <div className="app-hydrating" aria-busy="true" />
  }

  // First start (and after a career reset): the underdog story + guaranteed first match.
  // `introDone` is persisted in `progress`, so once finished it never returns until a reset.
  if (!progress.introDone) {
    return <Onboarding onDone={markIntroDone} />
  }

  function openLesson(lessonId: string) {
    setShowTest(false)
    setCurrentLesson(lessonId)
    setActiveLessonId(lessonId)
  }

  // Programmatic exit (finished / in-app "Back"): leaving the test ALWAYS abandons
  // the in-progress attempt, so reopening starts a brand-new test rather than
  // resuming where you left off. Strip the hash WITHOUT firing the hashchange
  // handler again, since we clear here directly.
  function exitTest() {
    clearTestSession(username)
    setShowTest(false)
    if (window.location.hash === TEST_HASH) {
      window.history.replaceState(null, '', window.location.pathname + window.location.search)
    }
  }

  if (activeLessonId) {
    return (
      <LessonPlayer
        lessonId={activeLessonId}
        onExit={() => setActiveLessonId(null)}
        onOpenLesson={openLesson}
      />
    )
  }

  return (
    <>
      <div className="app__bg" aria-hidden>
        <div className="app__bg-scrim" />
      </div>
      <div className="app__content">
        {showTest ? (
          <TestScreen onExit={exitTest} />
        ) : (
          <Dashboard />
        )}
      </div>
    </>
  )
}

export default function App() {
  // Unlock the Web Audio context on the first interaction anywhere in the app
  // (the match already does this, but the economy SFX need it on the dashboard).
  useEffect(() => {
    const unlock = () => unlockAudio()
    window.addEventListener('pointerdown', unlock, { once: true })
    window.addEventListener('keydown', unlock, { once: true })
    return () => {
      window.removeEventListener('pointerdown', unlock)
      window.removeEventListener('keydown', unlock)
    }
  }, [])

  return (
    <AppProvider>
      <PlayerProvider>
        <ToastProvider>
          <BallCursor />
          <main className="app">
            <Shell />
          </main>
        </ToastProvider>
      </PlayerProvider>
    </AppProvider>
  )
}
