import { useCallback, useEffect, useState } from 'react'
import { api, download } from '../api'
import { Badge, SubTabs, Toast, TopBar, iso, money, nice, time12, useLabel } from '../ui'
import { Staff, Settings, CalendarLink } from './Manage'
import Profile from './Profile'
import Dashboard from './Dashboard'
import { BookingModal, Customers, WalkIn } from './Owner'
import { Sales } from './Billing'
import Catalog from './Catalog'
import Marketing from './Marketing'
import Enquiries from './Enquiries'
import { MoneyReport } from './Reports'
import CalendarView from './Calendar'

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

function Bookings({ toast }) {
  const [date, setDate] = useState(iso(new Date()))
  const [rows, setRows] = useState(null)
  const [view, setView] = useState('calendar')
  const [sel, setSel] = useState(null)
  const [adding, setAdding] = useState(false)
  const load = useCallback(() => api('GET', '/admin/bookings?date=' + date).then(setRows), [date])
  useEffect(() => { load() }, [load])

  const setStatus = async (id, status) => {
    try {
      await api('PATCH', `/admin/bookings/${id}`, { status })
      toast('Updated')
      load()
    } catch (e) {
      toast(e.message)
    }
  }
  const shift = (n) => {
    const d = new Date(date + 'T00:00:00')
    d.setDate(d.getDate() + n)
    setDate(iso(d))
  }

  return (
    <>
      <div className="page-head row between wrap">
        <div>
          <h1>Appointments</h1>
          <p className="muted">{nice(date)}</p>
        </div>
        <div className="row wrap">
          <button className="btn sm" onClick={() => setAdding(true)}>+ Add appointment</button>
          <div className="view-toggle"><button className={view === 'calendar' ? 'on' : ''} onClick={() => setView('calendar')}>Calendar</button><button className={view === 'list' ? 'on' : ''} onClick={() => setView('list')}>List</button></div>
          <button className="btn ghost sm" onClick={() => shift(-1)}>‹ Prev</button>
          <input type="date" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} style={{ width: 160 }} />
          <button className="btn ghost sm" onClick={() => setDate(iso(new Date()))}>Today</button>
          <button className="btn ghost sm" onClick={() => shift(1)}>Next ›</button>
        </div>
      </div>
      {view === 'calendar' && rows && <CalendarView date={date} rows={rows} onSelect={setSel} />}
      {view === 'list' && <div className="card table-wrap" style={{ padding: 0 }}>
        {rows === null ? (
          <p className="muted" style={{ padding: 20 }}>Loading…</p>
        ) : rows.length === 0 ? (
          <div className="empty">No appointments on this day.</div>
        ) : (
          <table>
            <thead><tr><th>Time</th><th>Customer</th><th>Service</th><th>Status</th><th></th></tr></thead>
            <tbody>
              {rows.map((b) => (
                <tr key={b.id} onClick={() => setSel(b)} style={{ cursor: 'pointer' }}>
                  <td><b>{time12(b.start)}</b><div className="muted small">to {time12(b.end)}</div></td>
                  <td>{b.customer_name}<div className="muted small">{b.customer_phone}</div>{b.note && <div className="small">“{b.note}”</div>}</td>
                  <td>{b.service_name}<div className="muted small">{money(b.price)}{b.staff_name ? " · " + b.staff_name : ""}</div></td>
                  <td><Badge status={b.status} /></td>
                  <td onClick={(e) => e.stopPropagation()}>
                    {b.status === 'booked' && (
                      <div className="row wrap">
                        <button className="btn success sm" onClick={() => setStatus(b.id, 'completed')}>Complete</button>
                        <button className="btn ghost sm" onClick={() => setStatus(b.id, 'no_show')}>No-show</button>
                        <button className="btn danger sm" onClick={() => setStatus(b.id, 'cancelled')}>Cancel</button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>}
      {sel && <BookingModal b={sel} onClose={() => setSel(null)} onChanged={load} toast={toast} />}
      {adding && <WalkIn date={date} onClose={() => setAdding(false)} onDone={() => { setAdding(false); load() }} toast={toast} />}
    </>
  )
}

function Hours({ toast }) {
  const [hours, setHours] = useState([])
  const [holidays, setHolidays] = useState([])
  const [h, setH] = useState({ date: '', reason: '' })
  const load = useCallback(() => {
    api('GET', '/admin/hours').then(setHours)
    api('GET', '/admin/holidays').then(setHolidays)
  }, [])
  useEffect(() => { load() }, [load])

  const edit = (dow, k, v) => setHours(hours.map((x) => (x.dow === dow ? { ...x, [k]: v } : x)))
  const save = async (x) => {
    try {
      await api('PUT', '/admin/hours/' + x.dow, x.open ? { open: x.open, close: x.close } : { open: null, close: null })
      toast(DAYS[x.dow] + ' saved')
    } catch (e) {
      toast(e.message)
    }
  }
  const toggleOpen = (x) => {
    const n = x.open ? { ...x, open: null, close: null } : { ...x, open: '09:00', close: '18:00' }
    setHours(hours.map((y) => (y.dow === x.dow ? n : y)))
    save(n)
  }
  const addHoliday = async (e) => {
    e.preventDefault()
    try {
      await api('POST', '/admin/holidays', h)
      setH({ date: '', reason: '' })
      load()
    } catch (x) {
      toast(x.message)
    }
  }

  return (
    <>
      <div className="page-head"><h1>Working hours</h1><p className="muted">Slots are generated from these hours.</p></div>
      <div className="grid cols-2" style={{ alignItems: 'start' }}>
        <div className="card stack">
          {hours.map((x) => (
            <div key={x.dow} className="hours-row">
              <b>{DAYS[x.dow]}</b>
              {x.open ? (
                <div className="times">
                  <input type="time" value={x.open} onChange={(e) => edit(x.dow, 'open', e.target.value)} onBlur={() => save(x)} style={{ minWidth: 0 }} />
                  <span className="muted">to</span>
                  <input type="time" value={x.close} onChange={(e) => edit(x.dow, 'close', e.target.value)} onBlur={() => save(x)} style={{ minWidth: 0 }} />
                </div>
              ) : (
                <span className="muted">Closed</span>
              )}
              <button className="btn ghost sm" onClick={() => toggleOpen(x)}>{x.open ? 'Close day' : 'Open'}</button>
            </div>
          ))}
        </div>
        <div className="card stack">
          <h2>Holidays</h2>
          <form className="row wrap" onSubmit={addHoliday}>
            <input type="date" value={h.date} onChange={(e) => setH({ ...h, date: e.target.value })} required style={{ width: 150 }} />
            <input placeholder="Reason" value={h.reason} onChange={(e) => setH({ ...h, reason: e.target.value })} style={{ flex: 1, minWidth: 120 }} />
            <button className="btn">Add</button>
          </form>
          {holidays.length === 0 && <p className="muted small">No holidays set.</p>}
          {holidays.map((x) => (
            <div key={x.date} className="row between">
              <div><b>{nice(x.date)}</b><div className="muted small">{x.reason}</div></div>
              <button className="btn danger sm" onClick={() => api('DELETE', '/admin/holidays/' + x.date).then(load)}>Remove</button>
            </div>
          ))}
        </div>
      </div>
    </>
  )
}

function Report({ toast }) {
  const [month, setMonth] = useState(iso(new Date()).slice(0, 7))
  const [r, setR] = useState(null)
  useEffect(() => { api('GET', '/admin/report?month=' + month).then(setR) }, [month])
  const stats = r && [
    ['Bookings', r.bookings], ['Completed', r.completed], ['Cancelled', r.cancelled], ['No-shows', r.no_show],
  ]
  return (
    <>
      <div className="page-head row between wrap">
        <div><h1>Monthly report</h1><p className="muted">How the parlour is doing.</p></div>
        <div className="row wrap">
          <input type="month" value={month} onChange={(e) => e.target.value && setMonth(e.target.value)} style={{ width: 170 }} />
          <button className="btn ghost" onClick={() => download(`/admin/export?month=${month}`, `bookings-${month}.csv`).catch((e) => toast(e.message))}>Download CSV</button>
        </div>
      </div>
      {r && (
        <>
          <div className="card stat" style={{ marginBottom: 16, background: 'linear-gradient(135deg, var(--primary), var(--primary-dark))', color: '#fff' }}>
            <span style={{ color: 'rgba(255,255,255,.8)' }}>Income (completed services)</span>
            <b style={{ fontSize: '2.4rem' }}>{money(r.income)}</b>
          </div>
          <div className="grid cols-4 stats">
            {stats.map(([k, v]) => (
              <div key={k} className="card stat"><b>{v}</b><span>{k}</span></div>
            ))}
          </div>
          <MoneyReport month={month} />
        </>
      )}
    </>
  )
}

function Appointments({ toast }) {
  const [tab, setTab] = useState('bookings')
  const [fresh, setFresh] = useState(0)
  return (
    <>
      <SubTabs value={tab} onChange={setTab} items={[['bookings', 'Appointments'], ['enquiries', fresh ? `Enquiries (${fresh})` : 'Enquiries']]} />
      {tab === 'bookings' && <Bookings toast={toast} />}
      <div style={{ display: tab === 'enquiries' ? 'block' : 'none' }}><Enquiries toast={toast} onCount={setFresh} /></div>
    </>
  )
}

export default function Admin({ user, onLogout, onUser }) {
  const L = useLabel()
  const [tab, setTab] = useState('dashboard')
  const [msg, setMsg] = useState('')
  const toast = useCallback((m) => setMsg(m), [])
  return (
    <>
      <TopBar
        user={user} tab={tab} setTab={setTab} onLogout={onLogout}
        tabs={[['dashboard', 'Home'], ['bookings', 'Appointments'], ['sales', 'Sales'], ['customers', 'Customers'], ['catalog', 'Catalog'], ['staff', L.many], ['marketing', 'Marketing'], ['report', 'Report'], ['settings', 'Settings']]}
      />
      <main className="container">
        {tab === 'dashboard' && <Dashboard goTo={setTab} />}
        {tab === 'bookings' && <Appointments toast={toast} />}
        {tab === 'sales' && <Sales toast={toast} />}
        {tab === 'catalog' && <Catalog toast={toast} />}
        {tab === 'staff' && <Staff toast={toast} />}
        {tab === 'customers' && <Customers toast={toast} />}
        {tab === 'marketing' && <Marketing toast={toast} />}
        {tab === 'settings' && <><Settings toast={toast} /><div style={{ height: 24 }} /><CalendarLink toast={toast} /><div style={{ height: 24 }} /><Hours toast={toast} /><div style={{ height: 24 }} /><Profile user={user} onUser={onUser} toast={toast} /></>}
        {tab === 'report' && <Report toast={toast} />}
      </main>
      <Toast msg={msg} onDone={() => setMsg('')} />
    </>
  )
}
