import { useEffect, useState } from 'react'
import { api } from '../api'
import { time12 } from '../ui'

const PX = 60 // pixels per hour

// Day view: one column per stylist, appointments placed on a time axis.
export default function CalendarView({ date, rows, onSelect }) {
  const [staff, setStaff] = useState([])
  const [hours, setHours] = useState([])
  useEffect(() => {
    api('GET', '/admin/staff').then(setStaff).catch(() => {})
    api('GET', '/admin/hours').then(setHours).catch(() => {})
  }, [])

  const day = new Date(date + 'T00:00:00').getDay()
  const h = hours.find((x) => x.dow === day)
  const toMin = (t) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3))
  const live = rows.filter((b) => b.status !== 'cancelled')
  let open = h?.open ? toMin(h.open) : 9 * 60
  let close = h?.close ? toMin(h.close) : 18 * 60
  // never hide an appointment that falls outside the usual hours
  live.forEach((b) => { open = Math.min(open, Math.floor(b.start_min / 60) * 60); close = Math.max(close, Math.ceil(b.end_min / 60) * 60) })
  const hoursList = Array.from({ length: Math.ceil((close - open) / 60) }, (_, i) => open + i * 60)

  const cols = staff.filter((s) => s.active).map((s) => s.name)
  if (live.some((b) => !b.staff_name)) cols.push('Unassigned')
  live.forEach((b) => { if (b.staff_name && !cols.includes(b.staff_name)) cols.push(b.staff_name) })
  if (!cols.length) cols.push('Unassigned')

  if (h && !h.open && live.length === 0) return <div className="card empty">The parlour is closed on this day.</div>

  return (
    <div className="card cal-wrap">
      <div className="cal" style={{ gridTemplateColumns: `56px repeat(${cols.length}, minmax(130px, 1fr))` }}>
        <div className="cal-corner" />
        {cols.map((c) => <div key={c} className="cal-head">{c}</div>)}
        <div className="cal-axis" style={{ height: hoursList.length * PX }}>
          {hoursList.map((m, i) => <span key={m} style={{ top: i * PX }}>{time12(`${String(m / 60).padStart(2, '0')}:00`)}</span>)}
        </div>
        {cols.map((c) => (
          <div key={c} className="cal-col" style={{ height: hoursList.length * PX }}>
            {hoursList.map((m, i) => <i key={m} style={{ top: i * PX }} />)}
            {live.filter((b) => (b.staff_name || 'Unassigned') === c).map((b) => (
              <div
                key={b.id}
                role="button"
                tabIndex={0}
                onClick={() => onSelect?.(b)}
                onKeyDown={(e) => e.key === 'Enter' && onSelect?.(b)}
                className={'cal-ev ' + b.status}
                style={{ top: ((b.start_min - open) / 60) * PX, height: Math.max(26, ((b.end_min - b.start_min) / 60) * PX - 2) }}
                title={`${time12(b.start)} to ${time12(b.end)} · ${b.customer_name} · ${b.service_name}`}
              >
                <b>{time12(b.start)}</b> {b.customer_name}
                <div>{b.service_name}</div>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}
