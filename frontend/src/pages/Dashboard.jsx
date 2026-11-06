import { useEffect, useState } from 'react'
import { api, bizUrl } from '../api'
import { MoneyStrip } from './Reports'
import { Badge, Stars, money, parseDate, time12, useLabel, useSettings, waLink } from '../ui'

function BarChart({ data }) {
  const W = 640, H = 190, pad = { l: 28, r: 8, t: 14, b: 26 }
  const max = Math.max(1, ...data.map((d) => d.count))
  const top = Math.ceil(max / 2) * 2 || 2
  const bw = (W - pad.l - pad.r) / data.length
  const y = (v) => pad.t + (H - pad.t - pad.b) * (1 - v / top)
  const total = data.reduce((a, d) => a + d.count, 0)
  return (
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Bookings per day for the last 14 days, ${total} in total`} style={{ width: '100%', height: 'auto' }}>
      {[0, top / 2, top].map((v) => (
        <g key={v}>
          <line x1={pad.l} x2={W - pad.r} y1={y(v)} y2={y(v)} stroke="var(--line)" />
          <text x={pad.l - 6} y={y(v) + 4} textAnchor="end" fontSize="10" fill="var(--muted)">{v}</text>
        </g>
      ))}
      {data.map((d, i) => {
        const x = pad.l + i * bw + bw * 0.18
        const h = (H - pad.t - pad.b) * (d.count / top)
        const dt = parseDate(d.date)
        const isToday = i === data.length - 1
        return (
          <g key={d.date}>
            <rect x={x} y={y(d.count)} width={bw * 0.64} height={h} rx="4" fill={isToday ? 'var(--primary-dark)' : 'var(--primary)'} opacity={d.count ? 1 : 0}>
              <title>{`${dt.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}: ${d.count} booking${d.count === 1 ? '' : 's'}, ${money(d.income)} earned`}</title>
            </rect>
            {d.count > 0 && <text x={x + bw * 0.32} y={y(d.count) - 4} textAnchor="middle" fontSize="10" fontWeight="600" fill="var(--text)">{d.count}</text>}
            {(i % 2 === 1 || i === data.length - 1) && (
              <text x={x + bw * 0.32} y={H - 8} textAnchor="middle" fontSize="10" fill="var(--muted)">{dt.getDate()}</text>
            )}
          </g>
        )
      })}
    </svg>
  )
}

function HBars({ rows, value, label, format = (v) => v }) {
  const max = Math.max(1, ...rows.map(value))
  if (!rows.length) return <p className="muted small">Nothing yet this month.</p>
  return (
    <div className="stack" style={{ gap: 10 }}>
      {rows.map((r) => (
        <div key={label(r)}>
          <div className="row between small"><span>{label(r)}</span><b>{format(value(r))}</b></div>
          <div className="hbar"><span style={{ width: (value(r) / max) * 100 + '%' }} /></div>
        </div>
      ))}
    </div>
  )
}

// Link to share + first-steps checklist for a newly created business
function Setup({ goTo, hasBookings }) {
  const { settings } = useSettings()
  const [svc, setSvc] = useState(null)
  const [staff, setStaff] = useState(null)
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    api('GET', '/services/all').then((r) => setSvc(r.length)).catch(() => {})
    api('GET', '/admin/staff').then((r) => setStaff(r.length)).catch(() => {})
  }, [])
  const link = bizUrl()
  const copy = () => { navigator.clipboard?.writeText(link).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1800) }) }
  const steps = [
    ['Add your services and prices', svc > 0, 'services'],
    ['Add your team members', staff > 0, 'staff'],
    ['Check your opening hours and details', Boolean(settings.address || settings.phone), 'settings'],
  ]
  const todo = steps.some((s) => !s[1]) && !hasBookings
  return (
    <div className="card setup" style={{ marginBottom: 16 }}>
      <div className="row between wrap">
        <div><b>Your booking page</b><div className="small"><a href={link} target="_blank" rel="noreferrer">{link}</a></div></div>
        <div className="row wrap">
          <button className="btn ghost sm" onClick={copy}>{copied ? 'Copied!' : 'Copy link'}</button>
          <a className="btn ghost sm" href={waLink('Book your appointment at ' + settings.name + ': ' + link)} target="_blank" rel="noreferrer">Share on WhatsApp</a>
        </div>
      </div>
      {todo && (
        <div className="stack" style={{ gap: 8, marginTop: 14 }}>
          <b className="small">Get started</b>
          {steps.map(([t, done, tab]) => (
            <button key={t} className={'step-item' + (done ? ' done' : '')} onClick={() => goTo(tab)}><i>{done ? '✓' : ''}</i> {t}</button>
          ))}
        </div>
      )}
    </div>
  )
}

export default function Dashboard({ goTo }) {
  const L = useLabel()
  const [d, setD] = useState(null)
  useEffect(() => { api('GET', '/admin/dashboard').then(setD).catch(() => setD(false)) }, [])
  if (d === null) return <p className="muted">Loading…</p>
  if (d === false) return <div className="card empty">Could not load the dashboard.</div>

  const stats = [
    ["Today's appointments", d.today.total],
    ['Income this month', money(d.month.income)],
    ['Bookings this month', d.month.bookings],
    ['Customers this month', d.month.customers],
  ]
  const rated = d.rating.count > 0
  const hour = new Date().getHours()
  const greet = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening'

  return (
    <>
      <div className="page-head row between wrap">
        <div><h1>{greet} ✿</h1><p className="muted">Here is how the parlour is doing.</p></div>
        <button className="btn" onClick={() => goTo('bookings')}>Open calendar</button>
      </div>

      <Setup goTo={goTo} hasBookings={d.month.bookings > 0} />
      <MoneyStrip goTo={goTo} />

      <div className="grid cols-4 stats" style={{ marginBottom: 16 }}>
        {stats.map(([k, v]) => <div key={k} className="card stat"><b>{v}</b><span>{k}</span></div>)}
      </div>
      {rated && <div className="card row between" style={{ marginBottom: 16 }}><div className="rating-line"><b style={{ fontSize: '1.6rem' }}>{d.rating.average}</b><Stars value={d.rating.average} /><span className="muted small">from {d.rating.count} review{d.rating.count === 1 ? '' : 's'}</span></div></div>}

      <div className="grid cols-2" style={{ alignItems: 'start' }}>
        <div className="card" style={{ gridColumn: '1 / -1' }}>
          <div className="row between"><h2>Bookings, last 14 days</h2><span className="muted small">{d.daily.reduce((a, x) => a + x.count, 0)} total</span></div>
          <BarChart data={d.daily} />
        </div>

        <div className="card stack">
          <h2>Next up today</h2>
          {d.today.upcoming.length === 0 && <p className="muted small">No more appointments today.</p>}
          {d.today.upcoming.map((b) => (
            <div key={b.id} className="row between">
              <div>
                <b>{time12(b.start)}</b> · {b.customer_name}
                <div className="muted small">{b.service_name}{b.staff_name && ` · ${b.staff_name}`}</div>
              </div>
              <Badge status={b.status} />
            </div>
          ))}
        </div>

        <div className="card stack">
          <h2>Popular treatments</h2>
          <HBars rows={d.topServices} value={(r) => r.count} label={(r) => r.name} />
        </div>

        <div className="card stack" style={{ gridColumn: '1 / -1' }}>
          <h2>Income by {L.lower} <span className="muted small" style={{ fontWeight: 400 }}>(completed, this month)</span></h2>
          <HBars rows={d.byStaff} value={(r) => r.income} label={(r) => `${r.name} · ${r.count} done`} format={money} />
        </div>
      </div>
    </>
  )
}
