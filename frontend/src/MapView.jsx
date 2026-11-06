import { useEffect, useRef } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'

const INDIA = [20.59, 78.96]

const pin = (label) =>
  L.divIcon({
    className: 'map-pin',
    html: `<span><b>${label || ""}</b></span>`,
    iconSize: [30, 38],
    iconAnchor: [15, 36],
    popupAnchor: [0, -32],
  })

// Map on OpenStreetMap tiles (free, no API key).
//  - items: [{ slug, name, lat, lng, ... }] shown as pins; click a pin for a small card with a Book link
//  - picker mode (onPick): click the map or drag the pin to choose a location
export default function MapView({ items = [], me, pick, onPick, onSelect, height = 420 }) {
  const el = useRef(null)
  const map = useRef(null)
  const layer = useRef(null)
  const pickMarker = useRef(null)
  const meMarker = useRef(null)
  const onPickRef = useRef(onPick)
  onPickRef.current = onPick

  // create the map once
  useEffect(() => {
    const start = pick ? [pick.lat, pick.lng] : INDIA
    const m = L.map(el.current, { scrollWheelZoom: false }).setView(start, pick ? 15 : 5)
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    }).addTo(m)
    layer.current = L.layerGroup().addTo(m)
    if (onPickRef.current) {
      m.on('click', (e) => onPickRef.current({ lat: e.latlng.lat, lng: e.latlng.lng }))
    }
    map.current = m
    return () => { m.remove(); map.current = null }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // business pins
  useEffect(() => {
    const m = map.current
    if (!m || !layer.current) return
    layer.current.clearLayers()
    const pts = items.filter((b) => b.lat != null && b.lng != null)
    pts.forEach((b, i) => {
      const marker = L.marker([b.lat, b.lng], { icon: pin(i + 1) }).addTo(layer.current)
      // build the popup from DOM nodes so business names can never inject HTML
      const box = document.createElement('div')
      box.className = 'map-pop'
      const title = document.createElement('b')
      title.textContent = b.name
      const sub = document.createElement('div')
      sub.textContent = [b.city, b.rating ? `★ ${b.rating}` : null].filter(Boolean).join(' · ')
      const link = document.createElement('a')
      link.href = '/b/' + b.slug
      link.textContent = 'Book now'
      link.className = 'btn sm'
      box.append(title, sub, link)
      marker.bindPopup(box)
      marker.on('click', () => onSelect?.(b.slug))
    })
    if (!pick) {
      const all = pts.map((b) => [b.lat, b.lng]).concat(me ? [[me.lat, me.lng]] : [])
      if (all.length > 1) m.fitBounds(all, { padding: [40, 40], maxZoom: 14 })
      else if (all.length === 1) m.setView(all[0], 13)
    }
  }, [items, me, pick, onSelect])

  // "you are here"
  useEffect(() => {
    const m = map.current
    if (!m) return
    meMarker.current?.remove()
    meMarker.current = null
    if (me) meMarker.current = L.circleMarker([me.lat, me.lng], { radius: 8, color: '#fff', weight: 3, fillColor: '#2563eb', fillOpacity: 1 }).addTo(m).bindTooltip('You are here')
  }, [me])

  // location picker pin
  useEffect(() => {
    const m = map.current
    if (!m || !onPickRef.current) return
    pickMarker.current?.remove()
    pickMarker.current = null
    if (pick) {
      const mk = L.marker([pick.lat, pick.lng], { icon: pin('★'), draggable: true }).addTo(m)
      mk.on('dragend', () => { const p = mk.getLatLng(); onPickRef.current({ lat: p.lat, lng: p.lng }) })
      pickMarker.current = mk
      m.setView([pick.lat, pick.lng], Math.max(m.getZoom(), 15))
    }
  }, [pick?.lat, pick?.lng]) // eslint-disable-line react-hooks/exhaustive-deps

  return <div ref={el} className="map-box" style={{ height }} role="application" aria-label="Map" />
}
