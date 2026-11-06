import { useCallback, useEffect, useState } from 'react'
import { gapi, getSession, setSession } from '../api'
import { PLATFORM_NAME } from '../config'
import { Toast } from '../ui'

// Platform admin: the person who runs the hosted app sees and controls every business
export default function Platform() {
  const [session, setSess] = useState(getSession(null))
  const [f, setF] = useState({ phone: '', password: '' })
  const [err, setErr] = useState('')
  const [rows, setRows] = useState(null)
  const [msg, setMsg] = useState('')
  const [q, setQ] = useState('')

  const load = useCallback(() => gapi('GET', '/platform/businesses').then(setRows).catch((e) => setMsg(e.message)), [])
  useEffect(() => { if (session) load() }, [session, load])

  const login = async (e) => {
    e.preventDefault()
    setErr('')
    try {
      const r = await gapi('POST', '/platform/login', f)
      setSession(r, null)
      setSess(r)
    } catch (x) {
      setErr(x.message)
    }
  }
  const logout = () => { setSession(null, null); setSess(null); setRows(null) }
  const toggle = async (b) => {
    if (b.active && !window.confirm(`Suspend ${b.name}? Its page and logins stop working until you turn it back on.`)) return
    await gapi('PUT', '/platform/businesses/' + b.id, { active: !b.active })
    setMsg(b.active ? 'Suspended' : 'Activated')
    load()
  }

  if (!session) {
    return (
      <div className="auth-form" style={{ minHeight: '100vh' }}>
        <form className="card auth-card stack" onSubmit={login}>
          <div><h2>{PLATFORM_NAME} admin</h2><p className="muted small" style={{ marginTop: 4 }}>For the person who runs the platform.</p></div>
          <div><label>Phone</label><input value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} required /></div>
          <div><label>Password</label><input type="password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} required /></div>
          {err && <div className="error">{err}</div>}
          <button className="btn block">Login</button>
          <a className="muted small" href="/">Back to home</a>
        </form>
      </div>
    )
  }

  const shown = (rows || []).filter((b) => (b.name + b.slug + (b.owner_phone || '')).toLowerCase().includes(q.toLowerCase()))
  const totals = rows && { businesses: rows.length, active: rows.filter((b) => b.active).length, bookings: rows.reduce((a, b) => a + b.bookings, 0), customers: rows.reduce((a, b) => a + b.customers, 0) }

  return (
    <>
      <header className="topbar">
        <div className="topbar-inner">
          <div className="brand"><div className="brand-mark">✿</div> {PLATFORM_NAME} admin</div>
          <nav className="nav"><button onClick={logout}>Logout</button></nav>
        </div>
      </header>
      <main className="container">
        <div className="page-head row between wrap">
          <div><h1>Businesses</h1><p className="muted">Everyone who registered on your platform.</p></div>
          <input placeholder="Search name, address or phone" value={q} onChange={(e) => setQ(e.target.value)} style={{ maxWidth: 280 }} />
        </div>
        {totals && (
          <div className="grid cols-4 stats" style={{ marginBottom: 16 }}>
            {[['Businesses', totals.businesses], ['Active', totals.active], ['Bookings', totals.bookings], ['Customers', totals.customers]].map(([k, v]) => (
              <div key={k} className="card stat"><b>{v}</b><span>{k}</span></div>
            ))}
          </div>
        )}
        <div className="svc-list">
          {rows === null && <p className="muted">Loading…</p>}
          {rows && shown.length === 0 && <div className="card empty">No businesses found.</div>}
          {shown.map((b) => (
            <div key={b.id} className="card svc-item">
              <div className="main">
                <b>{b.name}</b> <span className="badge">{b.type}</span>
                <div className="small"><a href={'/b/' + b.slug} target="_blank" rel="noreferrer">/b/{b.slug}</a></div>
                <div className="muted small">Owner: {b.owner_name} · {b.owner_phone} · joined {b.created_at.slice(0, 10)}</div>
                <div className="muted small">{b.customers} customers · {b.bookings} bookings{b.last_booking_at && ` · last booking ${b.last_booking_at.slice(0, 10)}`}</div>
              </div>
              <span className={'badge ' + (b.active ? 'completed' : 'cancelled')}>{b.active ? 'Active' : 'Suspended'}</span>
              <button className={'btn sm ' + (b.active ? 'danger' : 'success')} onClick={() => toggle(b)}>{b.active ? 'Suspend' : 'Activate'}</button>
            </div>
          ))}
        </div>
      </main>
      <Toast msg={msg} onDone={() => setMsg('')} />
    </>
  )
}
