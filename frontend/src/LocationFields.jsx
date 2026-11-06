import { useState } from 'react'
import MapView from './MapView'
import { geocode, locate } from './geo'

// City, address and map pin for a business, plus the "show in directory" switch.
// value: { city, address, lat, lng, listed (boolean) }   onChange(patch)
export default function LocationFields({ value, onChange }) {
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)
  const has = value.lat !== '' && value.lat != null && value.lng !== '' && value.lng != null
  const pick = has ? { lat: Number(value.lat), lng: Number(value.lng) } : undefined
  const setPin = (p) => onChange({ lat: String(Number(p.lat).toFixed(6)), lng: String(Number(p.lng).toFixed(6)) })

  const run = async (fn) => {
    setMsg('')
    setBusy(true)
    try {
      setPin(await fn())
    } catch (e) {
      setMsg(e.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="stack" style={{ gap: 12 }}>
      <div className="form-grid">
        <div><label>City</label><input value={value.city || ''} onChange={(e) => onChange({ city: e.target.value })} placeholder="e.g. Pune" maxLength={60} /></div>
        <div><label>Address</label><input value={value.address || ''} onChange={(e) => onChange({ address: e.target.value })} placeholder="Street, area" maxLength={200} /></div>
      </div>
      <div>
        <label>Map location <span className="muted small" style={{ fontWeight: 400 }}>(so customers can find you on the map)</span></label>
        <div className="row wrap" style={{ marginBottom: 8 }}>
          <button type="button" className="btn ghost sm" disabled={busy || !(value.address || value.city)} onClick={() => run(() => geocode([value.address, value.city].filter(Boolean).join(', ')))}>Find my address on map</button>
          <button type="button" className="btn ghost sm" disabled={busy} onClick={() => run(locate)}>Use my current location</button>
          {has && <span className="small" style={{ color: 'var(--ok)' }}>Location set</span>}
        </div>
        <MapView height={240} pick={pick} onPick={setPin} />
        <p className="muted small" style={{ marginTop: 6 }}>{msg || 'Click the map or drag the pin to the exact spot.'}</p>
      </div>
      <label className="check" style={{ borderRadius: 12 }}>
        <input type="checkbox" checked={!!value.listed} onChange={(e) => onChange({ listed: e.target.checked })} /> Show my business in the public directory
      </label>
    </div>
  )
}
