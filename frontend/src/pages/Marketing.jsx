import { useCallback, useEffect, useState } from 'react'
import { api } from '../api'
import { SubTabs, useSettings, waLink } from '../ui'
import { Offers } from './Owner'

const SEGMENTS = [
  ['inactive', 'Not visited for a while', 'We miss you'],
  ['new', 'Registered, never visited', 'First visit'],
  ['birthday', 'Birthday this month', 'Birthdays'],
  ['top', 'Top 10 customers', 'Thank you'],
  ['all', 'All customers', 'Everyone'],
]

function Campaigns({ toast, onSent }) {
  const { settings } = useSettings()
  const [segment, setSegment] = useState('inactive')
  const [days, setDays] = useState(30)
  const [text, setText] = useState('')
  const [preview, setPreview] = useState(null)
  const [busy, setBusy] = useState(false)

  const templates = {
    inactive: `Hi {name}, we miss you at ${settings.name}! Book your next visit this week and get 10% off.`,
    new: `Hi {name}, welcome to ${settings.name}! Book your first visit and enjoy a special welcome offer.`,
    birthday: `Happy birthday {name}! 🎂 Enjoy a special gift from ${settings.name} this month. Book your visit today.`,
    top: `Hi {name}, thank you for being one of our best customers at ${settings.name}. Here is an exclusive offer just for you.`,
    all: `Hi {name}, new offers are live at ${settings.name}. Book online anytime.`,
  }
  useEffect(() => { setText(templates[segment]) }, [segment]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    setPreview(null)
    api('POST', '/admin/campaigns/preview', { segment, days }).then(setPreview).catch(() => setPreview({ count: 0, sample: [] }))
  }, [segment, days])

  const send = async () => {
    if (!window.confirm(`Queue this message for ${preview.count} customer${preview.count === 1 ? '' : 's'}?`)) return
    setBusy(true)
    try {
      const r = await api('POST', '/admin/campaigns/send', { segment, days, text })
      toast(`${r.queued} message${r.queued === 1 ? '' : 's'} queued`)
      onSent()
    } catch (x) { toast(x.message) } finally { setBusy(false) }
  }

  return (
    <div className="stack" style={{ maxWidth: 720 }}>
      <p className="muted">Send an offer or a hello to a group of customers. Customers who turned off offers in their profile are never included.</p>
      <div className="card form-card">
        <label>Who should get it?</label>
        <div className="chips" style={{ marginBottom: 12 }}>{SEGMENTS.map(([k, t]) => <button key={k} className={'chip' + (segment === k ? ' on' : '')} onClick={() => setSegment(k)}>{t}</button>)}</div>
        {segment === 'inactive' && <div style={{ maxWidth: 220, marginBottom: 12 }}><label>No visit for (days)</label><input type="number" min="7" max="365" value={days} onChange={(e) => setDays(Number(e.target.value) || 30)} /></div>}
        <p className="small" style={{ marginBottom: 12 }}>{preview === null ? 'Counting…' : <><b>{preview.count}</b> customer{preview.count === 1 ? '' : 's'}{preview.sample.length > 0 && <span className="muted"> · {preview.sample.join(', ')}{preview.count > preview.sample.length ? '…' : ''}</span>}</>}</p>
        <label>Message <span className="muted small" style={{ fontWeight: 400 }}>({'{name}'} becomes the customer's first name)</span></label>
        <textarea rows={4} value={text} onChange={(e) => setText(e.target.value)} maxLength={500} />
        <div className="row between wrap" style={{ marginTop: 12 }}>
          <span className="muted small">{text.length}/500</span>
          <button className="btn" disabled={busy || !preview || preview.count === 0 || text.trim().length < 5} onClick={send}>{busy ? 'Queuing…' : 'Queue messages'}</button>
        </div>
      </div>
    </div>
  )
}

const STATUS = { logged: ['Test mode', 'no_show'], sent: ['Sent', 'completed'], failed: ['Failed', 'cancelled'], queued: ['Queued', 'booked'], sending: ['Sending', 'booked'] }

function Messages({ toast }) {
  const [data, setData] = useState(null)
  const load = useCallback(() => api('GET', '/admin/messages').then(setData).catch((e) => toast(e.message)), [toast])
  useEffect(() => { load() }, [load])
  if (!data) return <p className="muted">Loading…</p>
  return (
    <>
      <div className={'card ' + (data.provider ? '' : 'setup')} style={{ marginBottom: 14 }}>
        {data.provider
          ? <p className="small"><b>A message provider is connected.</b> Queued messages are sent automatically.</p>
          : <p className="small"><b>Test mode.</b> No WhatsApp or SMS provider is connected to this site, so nothing is sent automatically. Messages are saved here, and you can send each one yourself with "Open WhatsApp". The site administrator can connect a provider later.</p>}
      </div>
      <div className="svc-list">
        {data.items.length === 0 && <div className="card empty">No messages yet. Reminders and campaigns appear here.</div>}
        {data.items.map((m) => (
          <div key={m.id} className="card svc-item">
            <div className="main">
              <b>{m.customer || m.phone}</b> <span className="badge">{m.kind}</span>
              <div className="small" style={{ marginTop: 2 }}>{m.text}</div>
              <div className="muted small">{m.created_at.slice(0, 16)} · {m.phone}{m.error ? ` · ${m.error}` : ''}</div>
            </div>
            <span className={'badge ' + STATUS[m.status]?.[1]}>{STATUS[m.status]?.[0] || m.status}</span>
            {m.kind !== 'otp' && <a className="btn ghost sm" href={waLink(m.text, m.phone)} target="_blank" rel="noreferrer">Open WhatsApp</a>}
          </div>
        ))}
      </div>
    </>
  )
}

export default function Marketing({ toast }) {
  const [tab, setTab] = useState('campaigns')
  return (
    <>
      <div className="page-head"><h1>Marketing</h1><p className="muted">Offers, messages and reminders.</p></div>
      <SubTabs value={tab} onChange={setTab} items={[['campaigns', 'Campaigns'], ['offers', 'Offers (coupons)'], ['messages', 'Messages']]} />
      {tab === 'campaigns' && <Campaigns toast={toast} onSent={() => setTab('messages')} />}
      {tab === 'offers' && <Offers toast={toast} embedded />}
      {tab === 'messages' && <Messages toast={toast} />}
    </>
  )
}
