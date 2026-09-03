/** Public-folder asset under Vite `base` (GitHub Pages `/HEX-watch/` etc.). */
export function assetUrl(path: string): string {
  const base = import.meta.env.BASE_URL || '/'
  const cleaned = path.replace(/^\//, '')
  return `${base}${cleaned}`
}
