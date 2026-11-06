import { createContext, useCallback, useContext, useEffect, useState } from 'react'
import { api } from './api'
import { dateLocale } from './ui-locale'
import { LangSwitcher, useT } from './i18n'

export const money = (n) => '₹' + Number(n).toLocaleString('en-IN')

export const dur = (m) => (m >= 60 ? `${Math.floor(m / 60)}h${m % 60 ? ' ' + (m % 60) + 'm' : ''}` : `${m} min`)

export const iso = (d) => {
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

// 'YYYY-MM-DD' -> local Date (avoids the UTC shift of new Date('YYYY-MM-DD'))
export const parseDate = (s) => {
  const [y, m, d] = s.split('-').map(Number)
  return new Date(y, m - 1, d)
}

export const nice = (s) => parseDate(s).toLocaleDateString(dateLocale(), { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })

export const time12 = (t) => {
  const [h, m] = t.split(':').map(Number)
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`
}

export const STATUS_LABEL = { booked: 'Upcoming', completed: 'Completed', cancelled: 'Cancelled', no_show: 'No-show' }

export function Badge({ status }) {
  const t = useT()
  return <span className={'badge ' + status}>{t(STATUS_LABEL[status] || status)}</span>
}

export function Toast({ msg, onDone }) {
  useEffect(() => {
    if (!msg) return
    const t = setTimeout(onDone, 2800)
    return () => clearTimeout(t)
  }, [msg, onDone])
  return msg ? <div className="toast">{msg}</div> : null
}

export const SettingsCtx = createContext({ settings: { name: "Blush & Bloom" }, setSettings: () => {} })
export const useSettings = () => useContext(SettingsCtx)

// "Blush & Bloom" -> "Blush & <em>Bloom</em>" (last word in the accent colour)
export function BrandName() {
  const { settings } = useSettings()
  const words = (settings.name || "").trim().split(" ")
  const last = words.length > 1 ? words.pop() : null
  return <>{words.join(" ")}{last && <> <em style={{ color: "var(--primary)" }}>{last}</em></>}</>
}

export function TopBar({ user, tabs, tab, setTab, onLogout, showLang }) {
  const t = useT()
  return (
    <header className="topbar">
      <div className="topbar-inner">
        <div className="brand">
          <div className="brand-mark">✿</div> <BrandName />
        </div>
        <nav className="nav">
          {tabs.map(([k, label]) => (
            <button key={k} className={tab === k ? 'active' : ''} onClick={() => setTab(k)}>
              {label}
            </button>
          ))}
          {showLang && <LangSwitcher />}
          <Bell />
          <button onClick={onLogout} title={user.name}>
            {t('Logout')}
          </button>
        </nav>
      </div>
    </header>
  )
}

// service name -> photo in /public/photos (falls back to the pink gradient)
export const photoFor = (name = '') => {
  const n = name.toLowerCase()
  if (/bridal|bride|wedding/.test(n)) return '/photos/bridal.jpg'
  if (/nail|mani|pedi/.test(n)) return '/photos/nails.jpg'
  if (/facial|skin|clean|glow|threading|wax/.test(n)) return '/photos/facial.jpg'
  if (/hair|cut|colour|color|style|spa/.test(n)) return '/photos/hair.jpg'
  return null
}

export const serviceImage = (s) => s.image_url || photoFor(s.name)

export const GALLERY = ['/photos/hair.jpg', '/photos/facial.jpg', '/photos/bridal.jpg', '/photos/nails.jpg', '/photos/hero.jpg']

export function Avatar({ name = '?', src, size = 44 }) {
  const initials = name.split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase()
  return (
    <span className="avatar" style={{ width: size, height: size, fontSize: size * 0.38, ...(src ? { backgroundImage: `url(${src})` } : {}) }}>
      {!src && initials}
    </span>
  )
}

// Pick one of the bundled photos, or paste an image link. (Free hosting cannot store uploads.)
export function ImagePicker({ value, onChange, gallery = GALLERY }) {
  return (
    <div className="stack" style={{ gap: 8 }}>
      {gallery.length > 0 && (
        <div className="picker">
          <button type="button" className={'pick none' + (!value ? ' on' : '')} onClick={() => onChange('')}>None</button>
          {gallery.map((g) => (
            <button type="button" key={g} className={'pick' + (value === g ? ' on' : '')} style={{ backgroundImage: `url(${g})` }} onClick={() => onChange(g)} aria-label="Choose photo" />
          ))}
        </div>
      )}
      <input value={value || ''} onChange={(e) => onChange(e.target.value)} placeholder="Or paste an image link (https://…)" />
    </div>
  )
}

export const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

const pad2 = (n) => String(n).padStart(2, '0')

// Downloads a calendar file (.ics) so the customer can add the appointment to Google/Apple/Outlook calendar
export function downloadIcs({ title, date, start, end, location = '', description = '' }) {
  const d = date.replace(/-/g, '')
  const t = (x) => x.replace(':', '') + '00'
  const lines = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Blush and Bloom//Booking//EN', 'BEGIN:VEVENT',
    `UID:${d}${t(start)}@blush-bloom`, `DTSTAMP:${new Date().toISOString().replace(/[-:]/g, '').slice(0, 15)}Z`,
    `DTSTART:${d}T${t(start)}`, `DTEND:${d}T${t(end)}`, `SUMMARY:${title}`,
    `LOCATION:${location}`, `DESCRIPTION:${description}`, 'END:VEVENT', 'END:VCALENDAR',
  ]
  const url = URL.createObjectURL(new Blob([lines.join('\r\n')], { type: 'text/calendar' }))
  const a = Object.assign(document.createElement('a'), { href: url, download: 'appointment.ics' })
  a.click()
  URL.revokeObjectURL(url)
}

export const addMinutes = (hhmm, mins) => {
  const [h, m] = hhmm.split(':').map(Number)
  const t = h * 60 + m + mins
  return `${pad2(Math.floor(t / 60))}:${pad2(t % 60)}`
}

// wa.me link that opens WhatsApp with a ready message (works with or without a phone number)
export const waLink = (text, phone = '') => {
  let p = phone.replace(/\D/g, '')
  if (p.length === 10) p = '91' + p // Indian mobile numbers
  return `https://wa.me/${p}?text=${encodeURIComponent(text)}`
}

export function Stars({ value = 0, onChange, size = 22 }) {
  return (
    <span className="stars" aria-label={`${value} out of 5`}>
      {[1, 2, 3, 4, 5].map((n) => (
        <button type="button" key={n} disabled={!onChange} onClick={() => onChange?.(n)} style={{ fontSize: size }} className={n <= Math.round(value) ? 'on' : ''} aria-label={`${n} star${n > 1 ? 's' : ''}`}>★</button>
      ))}
    </span>
  )
}

export function Modal({ title, onClose, children }) {
  const t = useT()
  useEffect(() => {
    const k = (e) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [onClose])
  return (
    <div className="modal-back" onClick={onClose}>
      <div className="modal card" role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <div className="row between" style={{ marginBottom: 12 }}><h2>{title}</h2><button className="btn ghost sm" onClick={onClose}>{t('Close')}</button></div>
        {children}
      </div>
    </div>
  )
}

const ago = (ts) => {
  const m = Math.max(0, Math.round((Date.now() - Date.parse(ts.replace(' ', 'T') + 'Z')) / 60000))
  if (m < 1) return 'just now'
  if (m < 60) return m + ' min ago'
  if (m < 1440) return Math.round(m / 60) + ' h ago'
  return Math.round(m / 1440) + ' d ago'
}

// Notification bell: polls every 30s; opening it marks everything as read
export function Bell() {
  const t = useT()
  const [data, setData] = useState({ unread: 0, items: [] })
  const [open, setOpen] = useState(false)
  const load = useCallback(() => api('GET', '/notifications').then(setData).catch(() => {}), [])
  useEffect(() => {
    load()
    const t = setInterval(load, 30000)
    return () => clearInterval(t)
  }, [load])
  const toggle = async () => {
    if (!open) {
      setOpen(true)
      if (data.unread) {
        await api('POST', '/notifications/read-all').catch(() => {})
        setData((d) => ({ ...d, unread: 0 }))
      }
    } else {
      setOpen(false)
      load()
    }
  }
  return (
    <span className="bell-wrap">
      <button className="bell" onClick={toggle} aria-label={`Notifications, ${data.unread} unread`}>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 8a6 6 0 10-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 01-3.4 0" /></svg>
        {data.unread > 0 && <i>{data.unread > 9 ? '9+' : data.unread}</i>}
      </button>
      {open && (
        <div className="bell-menu card">
          <b>{t('Notifications')}</b>
          {data.items.length === 0 && <p className="muted small" style={{ marginTop: 8 }}>{t('Nothing yet.')}</p>}
          {data.items.map((n) => (
            <div key={n.id} className={'note' + (n.read ? '' : ' new')}>{n.text}<small>{ago(n.created_at)}</small></div>
          ))}
        </div>
      )}
    </span>
  )
}

// The business's own word for its team members (Stylist, Doctor, Trainer, Staff ...)
export function useLabel() {
  const { settings } = useSettings()
  const one = (settings.staff_label || 'Staff').trim() || 'Staff'
  const many = /s$/i.test(one) || one.toLowerCase() === 'staff' ? one : one + 's'
  return { one, many, lower: one.toLowerCase(), lowerMany: many.toLowerCase() }
}

// Small row of pills for switching between sections of one page
export function SubTabs({ items, value, onChange }) {
  return (
    <div className="chips" style={{ marginBottom: 18 }} role="tablist">
      {items.map(([k, label]) => (
        <button key={k} type="button" role="tab" aria-selected={value === k} className={'chip' + (value === k ? ' on' : '')} onClick={() => onChange(k)}>{label}</button>
      ))}
    </div>
  )
}
