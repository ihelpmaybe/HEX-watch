/** eHEX chart: TradingView HUD (top + left drawing tools), dark + log + 4 dp. */
export function EhexLogChart() {
  const base = import.meta.env.BASE_URL || '/'
  // Bust cache so toolbar/log overrides pick up after edits.
  const src = `${base}ehex-tv.html?v=2`

  return (
    <div className="ehex-log-chart">
      <iframe
        className="chart-embed ehex-log-chart-canvas"
        title="eHEX / USD — TradingView"
        src={src}
        loading="lazy"
        allow="fullscreen; clipboard-write"
        referrerPolicy="no-referrer-when-downgrade"
      />
      <div className="ehex-log-chart-legend" aria-hidden="true">
        <span>eHEX / USD</span>
        <span>dark</span>
        <span>log</span>
        <span>4 dp</span>
      </div>
    </div>
  )
}
