import { useEffect, useState } from 'react'
import { AppProvider, useApp } from './state/AppState'
import { PlayerProvider } from './state/PlayerState'
import { Login } from './components/Login'
import { Dashboard } from './components/Dashboard'
import { LessonPlayer } from './components/LessonPlayer'
import { TestScreen } from './components/TestScreen'
import { BallCursor } from './components/BallCursor'
import { clearTestSession, loadTestSession } from './lib/storage'

const TEST_HASH = '#test'

function Shell() {
  const { isLoggedIn, setCurrentLesson, profile } = useApp()
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
      if (window.location.hash !== TEST_HASH) {
        clearTestSession(username)
        setShowTest(false)
      }
    }
    window.addEventListener('hashchange', onHashChange)
    return () => window.removeEventListener('hashchange', onHashChange)
  }, [username])

  if (!isLoggedIn) return <Login />

  function openLesson(lessonId: string) {
    setShowTest(false)
    setCurrentLesson(lessonId)
    setActiveLessonId(lessonId)
  }

  function openTest() {
    setShowTest(true)
    // pushes a history entry so the browser Back button exits the test
    window.location.hash = 'test'
  }

  // Programmatic exit (finished / in-app "Back"): strip the hash WITHOUT firing
  // the hashchange handler again, since the session was already handled.
  function exitTest() {
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
          <Dashboard onOpenLesson={openLesson} onOpenTest={openTest} />
        )}
      </div>
    </>
  )
}

export default function App() {
  return (
    <AppProvider>
      <PlayerProvider>
        <BallCursor />
        <main className="app">
          <Shell />
        </main>
      </PlayerProvider>
    </AppProvider>
  )
}
