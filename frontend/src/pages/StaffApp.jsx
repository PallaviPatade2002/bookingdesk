import { useCallback, useEffect, useState } from 'react'
import { api } from '../api'
import { Badge, Toast, TopBar, iso, money, nice, time12, useLabel } from '../ui'
import Profile from './Profile'

// A team member's own screen: today's work and what they earned. Nothing else is visible to them.
function Today({ toast }) {
  const L = useLabel()
  const [me, setMe] = useState(null)
  const [date, setDate] = useState(iso(new Date()))
  const [rows, setRows] = useState(null)
  const load = useCallback(() => api('GET', '/staff/bookings?date=' + date).then(setRows).catch((e) => toast(e.message)), [date, toast])
  useEffect(() => { load() }, [load])
  useEffect(() => { api('GET', '/staff/me').then(setMe).catch(() => {}) }, [])

  const shift = (n) => {
    const d = new Date(date + 'T00:00:00')
    d.setDate(d.getDate() + n)
    setDate(iso(d))
  }
  const mark = async (b, status) => {
    try {
      await api('PATCH', `/staff/bookings/${b.id}`, { status })
      toast(status === 'completed' ? 'Marked as done' : 'Marked as no-show')
      load()
    } catch (x) { toast(x.message) }
  }
  const live = (rows || []).filter((b) => b.status !== 'cancelled')

  return (
    <>
      <div className="page-head row between wrap">
        <div><h1>Hello{me ? ', ' + me.name : ''}</h1><p className="muted">Your {L.lower} schedule · {nice(date)}</p></div>
        <div className="row wrap">
          <button className="btn ghost sm" onClick={() => shift(-1)}>‹ Prev</button>
          <button className="btn ghost sm" onClick={() => setDate(iso(new Date()))}>Today</button>
          <button className="btn ghost sm" onClick={() => shift(1)}>Next ›</button>
        </div>
      </div>
      <div className="svc-list">
        {rows === null && <p className="muted">Loading…</p>}
        {rows && live.length === 0 && <div className="card empty">No appointments on this day.</div>}
        {live.map((b) => (
          <div key={b.id} className="card svc-item">
            <div className="booking-date"><small>{time12(b.start).split(' ')[1]}</small><b style={{ fontSize: '1rem' }}>{time12(b.start).split(' ')[0]}</b></div>
            <div className="main">
              <b>{b.service_name}</b>
              <div className="small">{b.customer_name} · <a href={'tel:' + b.customer_phone}>{b.customer_phone}</a></div>
              <div className="muted small">{time12(b.start)} – {time12(b.end)}{b.venue ? ` · ${b.venue}` : ''}</div>
              {b.note && <div className="small">“{b.note}”</div>}
            </div>
            <Badge status={b.status} />
            {b.status === 'booked' && (
              <div className="row wrap">
                <button className="btn success sm" onClick={() => mark(b, 'completed')}>Done</button>
                <button className="btn ghost sm" onClick={() => mark(b, 'no_show')}>No-show</button>
              </div>
            )}
          </div>
        ))}
      </div>
    </>
  )
}

function Earnings() {
  const [month, setMonth] = useState(iso(new Date()).slice(0, 7))
  const [e, setE] = useState(null)
  useEffect(() => { api('GET', '/staff/earnings?month=' + month).then(setE).catch(() => setE(false)) }, [month])
  return (
    <>
      <div className="page-head row between wrap">
        <div><h1>My earnings</h1><p className="muted">Commission on the services you did.</p></div>
        <input type="month" value={month} onChange={(x) => x.target.value && setMonth(x.target.value)} style={{ width: 170 }} />
      </div>
      {e === false && <div className="card empty">Could not load your earnings.</div>}
      {e && (
        <>
          <div className="card stat" style={{ marginBottom: 16, background: 'linear-gradient(135deg, var(--primary), var(--primary-dark))', color: '#fff' }}>
            <span style={{ color: 'rgba(255,255,255,.8)' }}>Commission this month ({e.pct}%)</span>
            <b style={{ fontSize: '2.4rem' }}>{money(e.commission)}</b>
          </div>
          <div className="grid cols-2 stats" style={{ marginBottom: 16 }}>
            <div className="card stat"><b>{e.services}</b><span>Services billed</span></div>
            <div className="card stat"><b>{money(e.base)}</b><span>Sales you made</span></div>
          </div>
          <div className="svc-list">
            {e.lines.length === 0 && <div className="card empty">Nothing billed yet this month.</div>}
            {e.lines.map((x, i) => (
              <div key={i} className="card row between"><div><b>{x.service}</b><div className="muted small">{x.date} · {x.customer}</div></div><div style={{ textAlign: 'right' }}><b>{money(x.commission)}</b><div className="muted small">of {money(x.amount)}</div></div></div>
            ))}
          </div>
        </>
      )}
    </>
  )
}

export default function StaffApp({ user, onLogout, onUser }) {
  const [tab, setTab] = useState('today')
  const [msg, setMsg] = useState('')
  const toast = useCallback((m) => setMsg(m), [])
  return (
    <>
      <TopBar user={user} tab={tab} setTab={setTab} onLogout={onLogout} tabs={[['today', 'My schedule'], ['earnings', 'My earnings'], ['profile', 'Profile']]} />
      <main className="container">
        {tab === 'today' && <Today toast={toast} />}
        {tab === 'earnings' && <Earnings />}
        {tab === 'profile' && <Profile user={user} onUser={onUser} toast={toast} />}
      </main>
      <Toast msg={msg} onDone={() => setMsg('')} />
    </>
  )
}
