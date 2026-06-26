import { useState } from 'react'
import { AppProvider, useApp } from './state/AppState'
import { PlayerProvider } from './state/PlayerState'
import { Login } from './components/Login'
import { Dashboard } from './components/Dashboard'
import { LessonPlayer } from './components/LessonPlayer'

function Shell() {
  const { isLoggedIn, setCurrentLesson } = useApp()
  const [activeLessonId, setActiveLessonId] = useState<string | null>(null)

  if (!isLoggedIn) return <Login />

  function openLesson(lessonId: string) {
    setCurrentLesson(lessonId)
    setActiveLessonId(lessonId)
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

  return <Dashboard onOpenLesson={openLesson} />
}

export default function App() {
  return (
    <AppProvider>
      <PlayerProvider>
        <main className="app">
          <Shell />
        </main>
      </PlayerProvider>
    </AppProvider>
  )
}
