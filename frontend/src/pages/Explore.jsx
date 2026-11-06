import { useEffect, useState } from 'react'
import { gapi } from '../api'
import { PLATFORM_NAME } from '../config'
import { locate } from '../geo'
import MapView from '../MapView'
import { Stars, money } from '../ui'

// Customers find businesses here: search by name or city, filter by type, sort by distance, see them on a map
export default function Explore() {
  const [q, setQ] = useState(() => new URLSearchParams(window.location.search).get('q') || '')
  const [type, setType] = useState('')
  const [types, setTypes] = useState([])
  const [me, setMe] = useState(null)
  const [geoErr, setGeoErr] = useState('')
  const [list, setList] = useState(null)
  const [view, setView] = useState('list') // phones show the list or the map, wide screens show both

  useEffect(() => { gapi('GET', '/types').then(setTypes).catch(() => {}) }, [])
  useEffect(() => {
    const t = setTimeout(() => {
      const qs = new URLSearchParams()
      if (q.trim()) qs.set('q', q.trim())
      if (type) qs.set('type', type)
      if (me) { qs.set('lat', me.lat); qs.set('lng', me.lng) }
      gapi('GET', '/directory?' + qs).then(setList).catch(() => setList([]))
    }, 250)
    return () => clearTimeout(t)
  }, [q, type, me])

  const near = async () => {
    setGeoErr('')
    if (me) return setMe(null)
    try {
      setMe(await locate())
    } catch (e) {
      setGeoErr(e.message)
    }
  }
  const typeLabel = (id) => types.find((t) => t.id === id)?.label || id

  return (
    <div className="lp">
      <header className="lp-nav">
        <div className="lp-wrap lp-nav-in">
          <a className="brand" href="/"><div className="brand-mark">✿</div> {PLATFORM_NAME}</a>
          <a className="btn ghost sm" href="/signup">List your business</a>
        </div>
      </header>

      <main className="lp-wrap explore">
        <div className="page-head">
          <h1>Find a business near you</h1>
          <p className="muted">Search salons, clinics, gyms and more. Open one to see services and book online.</p>
        </div>

        <div className="explore-bar">
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by name or city, for example Pune" aria-label="Search" />
          <button className={'btn' + (me ? '' : ' ghost')} onClick={near}>{me ? 'Near me: on' : 'Near me'}</button>
        </div>
        {geoErr && <div className="error" style={{ marginTop: 10 }}>{geoErr}</div>}
        <div className="chips" style={{ margin: '14px 0' }}>
          <button className={'chip' + (!type ? ' on' : '')} onClick={() => setType('')}>All</button>
          {types.map((t) => <button key={t.id} className={'chip' + (type === t.id ? ' on' : '')} onClick={() => setType(t.id)}>{t.label}</button>)}
        </div>

        <div className="row between" style={{ marginBottom: 10 }}>
          <span className="muted small">{list === null ? 'Searching…' : `${list.length} result${list.length === 1 ? '' : 's'}${me ? ', nearest first' : ''}`}</span>
          <div className="view-toggle explore-toggle">
            <button className={view === 'list' ? 'on' : ''} onClick={() => setView('list')}>List</button>
            <button className={view === 'map' ? 'on' : ''} onClick={() => setView('map')}>Map</button>
          </div>
        </div>

        <div className={'explore-grid show-' + view}>
          <div className="explore-list">
            {list && list.length === 0 && (
              <div className="card empty">No businesses found. Try another name or city, or clear the filters.</div>
            )}
            {(list || []).map((b, i) => (
              <a key={b.slug} className="card biz-card" href={'/b/' + b.slug}>
                <div className="biz-pic" style={b.image ? { backgroundImage: `url(${b.image})` } : undefined}><span>{i + 1}</span></div>
                <div className="biz-main">
                  <div className="row between"><b>{b.name}</b>{b.distance_km != null && <span className="badge">{b.distance_km} km</span>}</div>
                  <div className="muted small">{typeLabel(b.type)}</div>
                  <div className="small">{[b.address, b.city && !(b.address || '').toLowerCase().includes(b.city.toLowerCase()) ? b.city : ''].filter(Boolean).join(', ') || 'Address not added yet'}</div>
                  <div className="row small" style={{ gap: 10, marginTop: 4 }}>
                    {b.rating ? <span><Stars value={b.rating} size={14} /> {b.rating} ({b.rating_count})</span> : <span className="muted">New</span>}
                    {b.from_price != null && <span className="muted">{b.from_price === 0 ? 'Free to try' : `From ${money(b.from_price)}`}</span>}
                  </div>
                </div>
              </a>
            ))}
          </div>
          <div className="explore-map">
            <MapView items={list || []} me={me} height={560} />
          </div>
        </div>
      </main>
    </div>
  )
}
