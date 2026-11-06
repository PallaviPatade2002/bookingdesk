import { useEffect, useState } from 'react'
import { SINGLE, SLUG, api, getSession, setSession } from './api'
import { applyTheme } from './theme'
import { LangProvider } from './i18n'
import { PLATFORM_NAME } from './config'
import { SettingsCtx } from './ui'
import Home from './pages/Home'
import Onboard from './pages/Onboard'
import Platform from './pages/Platform'
import Explore from './pages/Explore'
import Login from './pages/Login'
import Landing from './pages/Landing'
import Customer from './pages/Customer'
import Admin from './pages/Admin'
import StaffApp from './pages/StaffApp'

// One business: its public page, customer app and owner app
function BusinessApp() {
  const [session, setSess] = useState(getSession())
  const [view, setView] = useState('landing')
  const [settings, setSettings] = useState(null)
  const [problem, setProblem] = useState('')

  useEffect(() => {
    api('GET', '/settings').then(setSettings).catch((e) => setProblem(e.message))
  }, [])
  useEffect(() => {
    if (!settings) return
    document.title = settings.name + ': Book an appointment'
    applyTheme(settings.brand, settings.font)
  }, [settings])

  if (problem) {
    return (
      <div className="auth-form" style={{ minHeight: '100vh' }}>
        <div className="card auth-card stack" style={{ textAlign: 'center' }}>
          <h2>{problem}</h2>
          <p className="muted small">Please check the web address, or contact the business directly.</p>
          {!SINGLE && <a className="btn" href="/">Go to {PLATFORM_NAME}</a>}
        </div>
      </div>
    )
  }
  if (!settings) return <div className="auth-form" style={{ minHeight: '100vh' }}><p className="muted">Loading…</p></div>

  const onAuth = (s) => {
    setSession(s)
    setSess(s)
  }
  const logout = () => { onAuth(null); setView('landing') }
  const onUser = (user) => onAuth({ ...session, user })

  let page
  if (!session && view === 'landing') page = <Landing onLogin={() => setView('login')} onSignup={() => setView('register')} />
  else if (!session) page = <Login onAuth={onAuth} initialMode={view} onBack={() => setView('landing')} />
  else if (session.user.role === 'admin') page = <Admin user={session.user} onLogout={logout} onUser={onUser} />
  else if (session.user.role === 'staff') page = <StaffApp user={session.user} onLogout={logout} onUser={onUser} />
  else page = <Customer user={session.user} onLogout={logout} onUser={onUser} />

  const ownerSide = session && (session.user.role === 'admin' || session.user.role === 'staff')
  return (
    <SettingsCtx.Provider value={{ settings, setSettings }}>
      <LangProvider defaultLang={settings.language} fixed={!!ownerSide}>{page}</LangProvider>
    </SettingsCtx.Provider>
  )
}

export default function App() {
  const path = window.location.pathname
  if (SINGLE) return <BusinessApp />
  if (path.startsWith('/platform')) return <Platform />
  if (path.startsWith('/signup')) return <Onboard />
  if (path.startsWith('/explore')) return <Explore />
  if (SLUG) return <BusinessApp />
  return <Home />
}
