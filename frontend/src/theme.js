// Builds a whole colour palette from one brand colour and applies it as CSS variables.
// Every business picks its own colour; the platform pages use a neutral one.

const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n))

function hexToHsl(hex) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const l = (max + min) / 2
  const d = max - min
  if (d === 0) return [0, 0, l * 100]
  const s = d / (1 - Math.abs(2 * l - 1))
  let h
  if (max === r) h = ((g - b) / d) % 6
  else if (max === g) h = (b - r) / d + 2
  else h = (r - g) / d + 4
  return [(h * 60 + 360) % 360, s * 100, l * 100]
}

function hslToRgb(h, s, l) {
  h = ((h % 360) + 360) % 360
  s = clamp(s, 0, 100) / 100
  l = clamp(l, 0, 100) / 100
  const c = (1 - Math.abs(2 * l - 1)) * s
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1))
  const m = l - c / 2
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x]
  return [r + m, g + m, b + m].map((v) => Math.round(v * 255))
}

const toHex = (rgb) => '#' + rgb.map((v) => v.toString(16).padStart(2, '0')).join('')
const fromHsl = (h, s, l) => toHex(hslToRgb(h, s, l))

const luminance = (rgb) => {
  const [r, g, b] = rgb.map((v) => {
    const c = v / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}
const contrastWithWhite = (rgb) => 1.05 / (luminance(rgb) + 0.05)

export const isHex = (v) => /^#[0-9a-fA-F]{6}$/.test(v || '')

// Returns the palette as CSS variable values. White text must stay readable on the brand colour,
// and accent text must stay readable on the page background, so colours are darkened until both are at least 4.5.
export function palette(brand) {
  let [h, s, l] = hexToHsl(isHex(brand) ? brand : '#4f46e5')
  s = Math.max(s, 25)
  const bg = hslToRgb(h, Math.min(s, 60), 96.5)
  const ratio = (x, y) => (Math.max(luminance(x), luminance(y)) + 0.05) / (Math.min(luminance(x), luminance(y)) + 0.05)
  // brand colour is used for button backgrounds (white text) and for accent text on the page background
  while ((contrastWithWhite(hslToRgb(h, s, l)) < 4.5 || ratio(hslToRgb(h, s, l), bg) < 4.5) && l > 8) l -= 2
  const primary = hslToRgb(h, s, l)
  const dark = hslToRgb(h, Math.min(s, 45), 17)
  return {
    '--primary': toHex(primary),
    '--primary-dark': toHex(dark),
    '--primary-soft': fromHsl(h, Math.min(s, 70), 94.5),
    '--primary-light': fromHsl(h, Math.min(s, 56), 75),
    '--primary-lighter': fromHsl(h, Math.min(s, 70), 87),
    '--accent': fromHsl(h + 35, 45, 62),
    '--bg': toHex(bg),
    '--line': fromHsl(h, Math.min(s, 45), 90),
    '--text': fromHsl(h, 30, 13),
    '--muted': fromHsl(h, 12, 40),
    '--ink': fromHsl(h, 30, 10),
    '--primary-rgb': primary.join(','),
    '--ink-rgb': dark.join(','),
    '--bg-rgb': bg.join(','),
  }
}

export function applyTheme(brand, font) {
  const root = document.documentElement
  const p = palette(brand)
  for (const [k, v] of Object.entries(p)) root.style.setProperty(k, v)
  const serif = font === 'serif'
  root.style.setProperty('--font-head', serif ? '"Playfair Display", Georgia, serif' : '"Inter", system-ui, sans-serif')
  root.style.setProperty('--head-weight', serif ? '500' : '650')
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', p['--primary'])
}
