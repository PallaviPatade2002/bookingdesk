import { useEffect, useState } from 'react'
import { api } from '../api'
import { money, useLabel } from '../ui'

const METHOD = { cash: 'Cash', upi: 'UPI', card: 'Card', package: 'Package sessions' }

// A short money summary for the Home screen
export function MoneyStrip({ goTo }) {
  const [m, setM] = useState(null)
  useEffect(() => { api('GET', '/admin/money').then(setM).catch(() => setM(null)) }, [])
  if (!m) return null
  const alerts = m.low_stock || []
  return (
    <>
      <div className="grid cols-4 stats" style={{ marginBottom: 16 }}>
        <div className="card stat"><b>{money(m.sales)}</b><span>Billed this month</span></div>
        <div className="card stat"><b>{money(m.received)}</b><span>Money received</span></div>
        <button className="card stat linkcard" onClick={() => goTo('sales')}><b style={{ color: m.due_total > 0 ? 'var(--warn)' : undefined }}>{money(m.due_total)}</b><span>Due from customers</span></button>
        <div className="card stat"><b>{m.invoices}</b><span>Bills this month</span></div>
      </div>
      {alerts.length > 0 && (
        <button className="card alertcard" onClick={() => goTo('catalog')}>
          <b>Low stock:</b> {alerts.map((p) => `${p.name} (${p.stock} left)`).join(', ')}
        </button>
      )}
    </>
  )
}

// Money part of the monthly report: sales, how it was paid, tax, commission
export function MoneyReport({ month }) {
  const L = useLabel()
  const [m, setM] = useState(null)
  useEffect(() => { api('GET', '/admin/money?month=' + month).then(setM).catch(() => setM(null)) }, [month])
  if (!m) return null
  return (
    <>
      <h2 style={{ margin: '28px 0 12px' }}>Sales and payments</h2>
      <div className="grid cols-4 stats">
        <div className="card stat"><b>{money(m.sales)}</b><span>Billed ({m.invoices} bills)</span></div>
        <div className="card stat"><b>{money(m.received)}</b><span>Received</span></div>
        <div className="card stat"><b>{money(m.tax)}</b><span>GST collected</span></div>
        <div className="card stat"><b>{money(m.tips)}</b><span>Tips</span></div>
      </div>
      <div className="grid cols-2" style={{ marginTop: 16, alignItems: 'start' }}>
        <div className="card stack">
          <h2>How customers paid</h2>
          {m.collected.length === 0 && <p className="muted small">No payments this month.</p>}
          {m.collected.map((c) => <div key={c.method} className="row between"><span>{METHOD[c.method] || c.method}</span><b>{money(c.amount)}</b></div>)}
          {m.discounts > 0 && <div className="row between muted small"><span>Discounts given</span><b>{money(m.discounts)}</b></div>}
          <div className="row between" style={{ borderTop: '1px solid var(--line)', paddingTop: 8 }}><span>Due from customers (all time)</span><b>{money(m.due_total)}</b></div>
        </div>
        <div className="card stack">
          <h2>{L.many} commission</h2>
          {m.commission.length === 0 && <p className="muted small">No commission this month. Set a commission % for each {L.lower} in the {L.many} tab.</p>}
          {m.commission.map((s) => (
            <div key={s.staff_id} className="row between">
              <span>{s.name} <span className="muted small">{s.pct}% of {money(s.base)}</span></span><b>{money(s.commission)}</b>
            </div>
          ))}
        </div>
      </div>
      {m.products.length > 0 && (
        <div className="card stack" style={{ marginTop: 16 }}>
          <h2>Products sold</h2>
          {m.products.map((p) => <div key={p.name} className="row between"><span>{p.name} × {p.qty}</span><b>{money(p.amount)}</b></div>)}
        </div>
      )}
    </>
  )
}
