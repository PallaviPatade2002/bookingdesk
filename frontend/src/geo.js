// Browser location and address lookup helpers (free OpenStreetMap services, no API key).
export const locate = () =>
  new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error('Location is not available in this browser'))
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude }),
      () => reject(new Error('Could not get your location. Allow location access and try again.')),
      { timeout: 10000 }
    )
  })

export async function geocode(query) {
  const r = await fetch('https://nominatim.openstreetmap.org/search?format=json&limit=1&q=' + encodeURIComponent(query))
  const j = await r.json().catch(() => [])
  if (!j[0]) throw new Error('Address not found. Try a nearby landmark, or click on the map.')
  return { lat: Number(j[0].lat), lng: Number(j[0].lon) }
}
