import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import {
  getCostBasis,
  loadCostBasis,
  replaceCostBasis,
  setCostBasisEntry,
  type CostBasisMap,
} from './costBasis'
import { buildLocalBackup, parseLocalBackup } from './backup'
import {
  BOTH_CHAINS,
  cacheIsStale,
  clearDemoWatchlist,
  installDemoWatchlist,
  loadSnapshot,
  missingWatchlistSnapshotsBoth,
  normalizeAddress,
  pruneCachedSnapshotsBoth,
  saveCachedSnapshots,
  saveWatchlist,
  seedSampleWatchlist,
  watchlistHasDemos,
  type AddressSnapshot,
  type StakeRow,
  type WatchedAddress,
} from './data'
import { formatGasCompare, loadGasBoard, loadGasHistory, type GasBoard } from './gasBoard'
import { loadQuotesBoth, money } from './quotes'
import { CHAINS, type ChainKey } from './hex'
import { deriveStatus, estimateHexDay, formatDayDate, hexDayToDate, servedDays } from './hexMath'
import {
  CHART_FAMILY_ROWS,
  DEFAULT_HEX_CHART_ID,
  chartEmbedUrl,
  chartPageUrl,
  chartsByFamily,
  hexChartById,
  type ChartFamily,
} from './pairTrades'
import { EhexLogChart } from './EhexLogChart'
import {
  fmtTshareHex,
  fmtTshareUsd,
  loadTshareBoth,
  sharesToTshares,
  type TshareSnap,
} from './tshare'
import { usePullToRefresh } from './usePullToRefresh'
import './styles.css'

type View = 'overview' | 'stakes' | 'addresses' | 'chart'

const VIEWS: View[] = ['overview', 'stakes', 'addresses', 'chart']

function viewFromHash(): View {
  const raw = window.location.hash.replace(/^#\/?/, '').split('/')[0]
  return VIEWS.includes(raw as View) ? (raw as View) : 'overview'
}

function hashForView(view: View): string {
  return view === 'overview' ? '#/' : `#/${view}`
}

interface FlatStake {
  key: string
  label: string
  address: string
  chain: ChainKey
  currentDay: number
  stake: StakeRow
  endDay: number
  daysLeft: number | null
}

function HexBackdrop() {
  return <div className="hex-backdrop" aria-hidden="true" />
}

function ThinkingEyebrow({ text, thinking }: { text: string; thinking: boolean }) {
  if (!thinking) {
    return <p className="eyebrow">{text}</p>
  }
  return (
    <p className="eyebrow is-thinking" aria-live="polite">
      {Array.from(text).map((ch, i) => (
        <span key={`${i}-${ch}`} style={{ animationDelay: `${i * 55}ms` }}>
          {ch === ' ' ? '\u00a0' : ch}
        </span>
      ))}
    </p>
  )
}

function formatHex(value: string) {
  const n = Number(value)
  if (!Number.isFinite(n)) return '—'
  return n.toLocaleString(undefined, { maximumFractionDigits: 2 })
}

/** HDRN can be dust vs HEX — don't round a paying balance to 0. */
function formatHdrn(value: string) {
  const n = Number(value)
  if (!Number.isFinite(n)) return '—'
  if (n === 0) return '0'
  const digits = n >= 1 ? 2 : n >= 0.01 ? 4 : 6
  return n.toLocaleString(undefined, { maximumFractionDigits: digits })
}

function formatCom(value: string) {
  const n = Number(value)
  if (!Number.isFinite(n)) return '—'
  if (n === 0) return '0'
  if (n >= 1e12) return `${(n / 1e12).toLocaleString(undefined, { maximumFractionDigits: 2 })}T`
  if (n >= 1e9) return `${(n / 1e9).toLocaleString(undefined, { maximumFractionDigits: 2 })}B`
  if (n >= 1e6) return `${(n / 1e6).toLocaleString(undefined, { maximumFractionDigits: 2 })}M`
  if (n >= 1e3) return `${(n / 1e3).toLocaleString(undefined, { maximumFractionDigits: 1 })}k`
  const digits = n >= 1 ? 2 : 4
  return n.toLocaleString(undefined, { maximumFractionDigits: digits })
}

function comWorthClaiming(s: StakeRow): boolean {
  const amount = Number(s.comClaimable)
  if (!Number.isFinite(amount) || amount <= 0) return false
  const value = parseMoney(s.comClaimableUsd)
  return value != null && value > 0
}

function compactChainQuote(raw: string): string {
  const m = raw.trim().match(/^([\d,.]+)\s+(PLS|ETH)$/i)
  if (!m) return raw
  const n = Number(m[1].replace(/,/g, ''))
  if (!Number.isFinite(n)) return raw
  const unit = m[2].toUpperCase()
  if (unit === 'ETH') {
    return `${n.toLocaleString(undefined, { maximumFractionDigits: n >= 1 ? 3 : 4 })} ETH`
  }
  if (n >= 1e9) {
    return `${(n / 1e9).toLocaleString(undefined, { maximumFractionDigits: 2 })}B PLS`
  }
  if (n >= 1e6) {
    return `${(n / 1e6).toLocaleString(undefined, { maximumFractionDigits: 1 })}M PLS`
  }
  if (n >= 1e4) {
    return `${(n / 1e3).toLocaleString(undefined, { maximumFractionDigits: 0 })}k PLS`
  }
  return `${n.toLocaleString(undefined, { maximumFractionDigits: 0 })} PLS`
}

function parseMoney(value: string | undefined): number | null {
  if (!value || value === '—') return null
  const n = Number(value.replace(/[^0-9.-]/g, ''))
  return Number.isFinite(n) ? n : null
}

function formatSignedUsd(n: number | null): string {
  if (n == null || !Number.isFinite(n)) return '—'
  const abs = money(Math.abs(n))
  if (n > 0) return `+${abs}`
  if (n < 0) return `−${abs}`
  return abs
}

function formatTshareCount(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '0'
  if (n >= 1000) return n.toLocaleString(undefined, { maximumFractionDigits: 1 })
  if (n >= 1) return n.toLocaleString(undefined, { maximumFractionDigits: 2 })
  return n.toLocaleString(undefined, { maximumFractionDigits: 4 })
}

interface MaturityBucket {
  key: string
  label: string
  count: number
  hex: number
  sort: number
}

function maturityMonthKey(endDay: number): string {
  const d = hexDayToDate(endDay)
  const y = d.getUTCFullYear()
  const m = d.getUTCMonth()
  return `${y}-${String(m + 1).padStart(2, '0')}`
}

function maturityMonthLabel(endDay: number): string {
  return hexDayToDate(endDay).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  })
}

function maturityCalendar(rows: FlatStake[]): MaturityBucket[] {
  const map = new Map<string, MaturityBucket>()
  for (const row of rows) {
    if (row.stake.status === 'ended') continue
    const key = maturityMonthKey(row.endDay)
    const existing = map.get(key)
    const hex = Number(row.stake.currentHex) || 0
    if (existing) {
      existing.count += 1
      existing.hex += hex
    } else {
      const d = hexDayToDate(row.endDay)
      const y = d.getUTCFullYear()
      const m = d.getUTCMonth()
      map.set(key, {
        key,
        label: maturityMonthLabel(row.endDay),
        count: 1,
        hex,
        sort: y * 12 + m,
      })
    }
  }
  return [...map.values()].sort((a, b) => a.sort - b.sort).slice(0, 8)
}

/** Hedron mintNative is a bit lighter than HEX stakeEnd (~140k). */
const MINT_GAS_VS_END = 110 / 140

function hdrnWorthMinting(s: StakeRow, chain: ChainKey): boolean {
  if (s.hdrnLoaned) return true
  const amount = Number(s.hdrnClaimable)
  if (!Number.isFinite(amount) || amount <= 0) return false
  const value = parseMoney(s.hdrnClaimableUsd)
  if (value == null) return true
  if (value <= 0) return false
  const endGasUsd =
    parseMoney(s.gasUsd) ?? parseMoney(chain === 'ethereum' ? s.gasEthUsd : s.gasPlsUsd)
  if (endGasUsd == null || endGasUsd <= 0) return true
  return value > endGasUsd * MINT_GAS_VS_END
}

function shortAddr(address: string) {
  return `${address.slice(0, 6)}…${address.slice(-4)}`
}

/** Real user nickname — not the auto short-addr and not seed “Sample · …” noise. */
function hasCustomLabel(label: string, address: string) {
  const short = shortAddr(address)
  if (!label || label === short || label.toLowerCase() === address.toLowerCase()) return false
  if (/^sample\b/i.test(label.trim())) return false
  return true
}

function walletDisplayName(label: string, address: string) {
  return hasCustomLabel(label, address) ? label : shortAddr(address)
}

const ADDR_COLORS = [
  '#5eead4',
  '#a78bfa',
  '#fbbf24',
  '#34d399',
  '#fb7185',
  '#60a5fa',
  '#f472b6',
  '#c084fc',
  '#2dd4bf',
  '#facc15',
  '#38bdf8',
  '#f97316',
] as const

function addressColor(address: string): string {
  let hash = 0
  const key = address.toLowerCase()
  for (let i = 0; i < key.length; i += 1) {
    hash = (hash * 31 + key.charCodeAt(i)) >>> 0
  }
  return ADDR_COLORS[hash % ADDR_COLORS.length]
}

type SortKey = 'soonest' | 'size' | 'start' | 'end'

function ChainIcon({ chain }: { chain: ChainKey }) {
  if (chain === 'ethereum') {
    return <img className="chain-icon eth" src="/brand/eth.svg" alt="" />
  }
  return <img className="chain-icon pls" src="/brand/pls.png" alt="" />
}

function StakeCard({
  row,
  i,
  costUsd,
  onSetCost,
}: {
  row: FlatStake
  i: number
  costUsd: number | null
  onSetCost: (usd: number | null) => void
}) {
  const s = row.stake
  const addr = shortAddr(row.address)
  const name = walletDisplayName(row.label, row.address)
  const named = hasCustomLabel(row.label, row.address)
  const color = addressColor(row.address)
  const chainLabel = CHAINS[row.chain].label
  const explorer = CHAINS[row.chain].explorerStake?.(row.address)
  const [lateOpen, setLateOpen] = useState(false)
  const [editingCost, setEditingCost] = useState(false)
  const [costDraft, setCostDraft] = useState('')
  const thin = s.status === 'late' && !lateOpen
  const nowUsd = parseMoney(s.currentUsd)
  const markedYield = parseMoney(s.startUsd) != null && nowUsd != null
    ? nowUsd - (parseMoney(s.startUsd) ?? 0)
    : null
  const interestUsd = formatSignedUsd(markedYield)
  const pnlUsd =
    costUsd != null && nowUsd != null ? nowUsd - costUsd : null

  function startCostEdit() {
    setCostDraft(costUsd != null ? costUsd.toFixed(2).replace(/\.00$/, '') : '')
    setEditingCost(true)
  }

  function commitCost() {
    const trimmed = costDraft.trim().replace(/[$,\s]/g, '')
    if (!trimmed) {
      onSetCost(null)
      setEditingCost(false)
      return
    }
    const n = Number(trimmed)
    if (!Number.isFinite(n) || n < 0) return
    onSetCost(n)
    setEditingCost(false)
  }

  function clearCost() {
    onSetCost(null)
    setCostDraft('')
    setEditingCost(false)
  }

  const draftUsd = (() => {
    const trimmed = costDraft.trim().replace(/[$,\s]/g, '')
    if (!trimmed) return null
    const n = Number(trimmed)
    return Number.isFinite(n) && n >= 0 ? n : null
  })()
  const draftPnl =
    draftUsd != null && nowUsd != null ? nowUsd - draftUsd : null
  const countdown =
    s.status === 'active' && row.daysLeft != null
      ? `${row.daysLeft}d left`
      : s.status === 'mature' && row.daysLeft != null
        ? `${row.daysLeft}d grace`
        : s.status === 'late' && row.daysLeft != null
          ? `${row.daysLeft}d`
          : s.status === 'scheduled'
            ? 'not locked yet'
            : null
  const hdrnMeta = s.hdrnLoaned
    ? 'locked'
    : [
        s.hdrnClaimableUsd ?? '—',
        s.hdrnLaunchBonus ? `LPB ${(s.hdrnLaunchBonus / 10).toFixed(0)}×` : null,
        s.hdrnMintedDays ? `minted ${s.hdrnMintedDays}d` : null,
      ]
        .filter(Boolean)
        .join(' · ')

  return (
    <article
      className={`stake-card status-${s.status}${thin ? ' is-thin' : ''}`}
      style={{ animationDelay: `${i * 28}ms`, ['--addr-color' as string]: color }}
    >
      {thin ? (
        <button type="button" className="late-thin" onClick={() => setLateOpen(true)}>
          <ChainIcon chain={row.chain} />
          <strong>
            {formatHex(s.currentHex)}
            <em> HEX</em>
          </strong>
          <span className={`status ${s.status}`}>
            late
            {countdown ? <em>{countdown}</em> : null}
          </span>
          <small>
            {addr} · keep {formatHex(s.ifEndedHex)}
          </small>
        </button>
      ) : (
        <>
      <header className="stake-card-head">
        <div className="stake-card-id">
          <p className="wallet-addr-top" title={row.address}>
            {named ? `${name} · ` : ''}
            {addr}
          </p>
          <div className="stake-card-top">
            <div className="stake-card-title">
              {explorer ? (
                <a
                  className={`chain-badge chain-${row.chain}`}
                  href={explorer}
                  target="_blank"
                  rel="noreferrer"
                  title={`${chainLabel} explorer`}
                  aria-label={`${chainLabel} explorer`}
                >
                  <ChainIcon chain={row.chain} />
                </a>
              ) : (
                <span className={`chain-badge chain-${row.chain}`} title={chainLabel} aria-label={chainLabel}>
                  <ChainIcon chain={row.chain} />
                </span>
              )}
              <h3>
                {formatHex(s.currentHex)}
                <em> HEX</em>
                {s.hsi ? <span className="hsi-tag">HSI</span> : null}
              </h3>
            </div>
            <span
              className={`status ${s.status}`}
              {...(s.status === 'late'
                ? {
                    role: 'button',
                    tabIndex: 0,
                    title: 'Minimize late stake',
                    onClick: () => setLateOpen(false),
                    onKeyDown: (e: { key: string }) => {
                      if (e.key === 'Enter' || e.key === ' ') setLateOpen(false)
                    },
                  }
                : {})}
            >
              {s.status}
              {countdown ? <em>{countdown}</em> : null}
            </span>
          </div>
        </div>
      </header>

      <div className="stake-timeline">
        <div className="timeline-row">
          <time className="timeline-start" dateTime={s.startDate}>
            {s.startDate}
          </time>
          <div className="timeline-track">
            <div
              className="progress-cell"
              role="progressbar"
              aria-valuenow={s.progressPct}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label={`${s.progressPct}% of ${s.stakedDays}d term`}
            >
              <i style={{ width: `${s.progressPct}%` }} />
            </div>
            <p className="timeline-meta">
              <span>
                {s.stakedDays}d · grace {s.graceEndDate}
              </span>
              <em>{s.progressPct}%</em>
            </p>
          </div>
          <time className="timeline-end" dateTime={s.endDate}>
            {s.endDate}
          </time>
        </div>
      </div>

      <div className="stake-ledger" role="table" aria-label="Stake values">
        <div className="ledger-line head" role="row">
          <span className="metric" />
          <span>HEX</span>
          <span>USD</span>
        </div>
        <div className="ledger-line" role="row">
          <span className="metric">Principal</span>
          <strong>{formatHex(s.stakedHex)}</strong>
          <span className="usd">{s.startUsd}</span>
        </div>
        <div className="ledger-line" role="row">
          <span className="metric">Now</span>
          <strong>{formatHex(s.currentHex)}</strong>
          <span
            className="usd"
            title={
              row.chain === 'pulsechain' && s.currentPls && s.currentPls !== '—'
                ? `${s.currentUsd} · ${s.currentPls}`
                : row.chain === 'ethereum' && s.currentEth && s.currentEth !== '—'
                  ? `${s.currentUsd} · ${s.currentEth}`
                  : undefined
            }
          >
            {s.currentUsd}
            {row.chain === 'pulsechain' && s.currentPls && s.currentPls !== '—' ? (
              <em className="eth-tag"> · {compactChainQuote(s.currentPls)}</em>
            ) : row.chain === 'ethereum' && s.currentEth && s.currentEth !== '—' ? (
              <em className="eth-tag"> · {compactChainQuote(s.currentEth)}</em>
            ) : null}
          </span>
        </div>
        <div className="ledger-line" role="row">
          <span className="metric">Interest</span>
          <strong>{formatHex(s.payoutHex)}</strong>
          <span className="usd">
            {interestUsd}
            <em className="apy-tag"> · APY {s.apy}</em>
          </span>
        </div>
        {editingCost ? (
          <div className="ledger-line cost is-editing" role="row">
            <span className="metric">Cost basis</span>
            <form
              className="cost-edit-form"
              onSubmit={(e) => {
                e.preventDefault()
                commitCost()
              }}
            >
              <label className="cost-input">
                <span aria-hidden="true">$</span>
                <input
                  type="text"
                  inputMode="decimal"
                  value={costDraft}
                  onChange={(e) => setCostDraft(e.target.value)}
                  placeholder="0.00"
                  aria-label="Cost basis USD"
                  autoFocus
                />
              </label>
              <button type="submit" className="ghost cost-btn">
                Save
              </button>
              <button
                type="button"
                className="text-link"
                onClick={() => setEditingCost(false)}
              >
                Cancel
              </button>
              {costUsd != null ? (
                <button type="button" className="text-link" onClick={clearCost}>
                  Clear
                </button>
              ) : null}
              {draftPnl != null ? (
                <em className={`cost-draft-pnl ${draftPnl >= 0 ? 'up' : 'down'}`}>
                  P&L {formatSignedUsd(draftPnl)}
                </em>
              ) : null}
            </form>
          </div>
        ) : (
          <div className="ledger-line cost" role="row">
            <span className="metric">Cost basis</span>
            <strong>{costUsd != null ? money(costUsd) : '—'}</strong>
            <span className="usd">
              <button type="button" className="text-link cost-edit" onClick={startCostEdit}>
                {costUsd != null ? 'Edit' : 'Set USD'}
              </button>
              {pnlUsd != null ? (
                <em className={`apy-tag pnl ${pnlUsd >= 0 ? 'up' : 'down'}`}>
                  {' '}
                  · P&L {formatSignedUsd(pnlUsd)}
                </em>
              ) : null}
            </span>
          </div>
        )}
        <div className="ledger-line" role="row">
          <span className="metric">If ended</span>
          <strong>{formatHex(s.ifEndedHex)}</strong>
          <span className="usd">Penalty {formatHex(s.penaltyHex)}</span>
        </div>
        {hdrnWorthMinting(s, row.chain) ? (
          <div className="ledger-line hdrn" role="row">
            <span className="metric">HDRN mint</span>
            <strong>{s.hdrnLoaned ? 'loaned' : formatHdrn(s.hdrnClaimable ?? '0')}</strong>
            <span className="usd">{hdrnMeta}</span>
          </div>
        ) : null}
        {comWorthClaiming(s) ? (
          <div className="ledger-line com" role="row">
            <span className="metric">COM claim</span>
            <strong>{formatCom(s.comClaimable ?? '0')}</strong>
            <span className="usd">
              {s.comClaimableUsd}
              {s.comClaimKind ? (
                <em className="apy-tag"> · {s.comClaimKind}</em>
              ) : null}
            </span>
          </div>
        ) : null}
        <div className="ledger-line gas" role="row" title={s.gasNote}>
          <span className="metric">Unstake gas</span>
          <strong>{s.gasNative}</strong>
          <span className="usd">{s.gasUsd}</span>
        </div>
      </div>

      {s.hsi ? (
        <footer className="stake-foot">
          <p>
            <span>HSI</span>
            {shortAddr(s.hsi)}
          </p>
        </footer>
      ) : null}
        </>
      )}
    </article>
  )
}

export function App() {
  const [view, setView] = useState<View>(() =>
    typeof window !== 'undefined' ? viewFromHash() : 'overview',
  )
  const [chain, setChain] = useState<ChainKey | 'all'>('all')
  const [watchlist, setWatchlist] = useState<WatchedAddress[]>(() => seedSampleWatchlist())
  const [addressInput, setAddressInput] = useState('')
  const [labelInput, setLabelInput] = useState('')
  const [formError, setFormError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [snapshots, setSnapshots] = useState<AddressSnapshot[]>(() => {
    const seeded = seedSampleWatchlist()
    return pruneCachedSnapshotsBoth(seeded).snapshots
  })
  const [cacheSavedAt, setCacheSavedAt] = useState<string | null>(() => {
    const seeded = seedSampleWatchlist()
    return pruneCachedSnapshotsBoth(seeded).savedAt
  })
  const [filter, setFilter] = useState<'all' | StakeRow['status']>('all')
  const [addrFilter, setAddrFilter] = useState<'all' | string>('all')
  const [monthFilter, setMonthFilter] = useState<string | null>(null)
  const [sortBy, setSortBy] = useState<SortKey>('soonest')
  const [hexDay, setHexDay] = useState(() => estimateHexDay())
  const [askUpdate, setAskUpdate] = useState(false)
  const [updateReason, setUpdateReason] = useState<string | null>(null)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [chartTab, setChartTab] = useState(DEFAULT_HEX_CHART_ID)
  const [chartFamily, setChartFamily] = useState<ChartFamily>('hex')
  const syncingRef = useRef(false)
  const importFileRef = useRef<HTMLInputElement>(null)
  const [gasBoard, setGasBoard] = useState<GasBoard | null>(() => {
    const history = loadGasHistory()
    const last = history[history.length - 1]
    if (!last) return null
    return {
      ethGwei: last.ethGwei,
      plsGwei: last.plsGwei,
      ethUsd: last.ethUsd,
      plsUsd: last.plsUsd,
      premium: last.premium,
      premiumLabel: formatGasCompare({
        ethGwei: last.ethGwei,
        plsGwei: last.plsGwei,
        ethUsd: last.ethUsd,
        plsUsd: last.plsUsd,
        premium: last.premium,
        premiumLabel: '',
        history,
        sampledAt: last.at,
      }).premiumLabel,
      history,
      sampledAt: last.at,
    }
  })
  const [tshareBoard, setTshareBoard] = useState<Record<ChainKey, TshareSnap> | null>(null)
  const [costBasis, setCostBasis] = useState<CostBasisMap>(() => loadCostBasis())

  const chainMeta =
    chain === 'all'
      ? { key: 'all' as const, label: 'ETH + Pulse' }
      : CHAINS[chain]
  const gasCompare = useMemo(() => formatGasCompare(gasBoard), [gasBoard])
  const activeChart = useMemo(() => hexChartById(chartTab), [chartTab])
  const familyPairTabs = useMemo(() => chartsByFamily(chartFamily), [chartFamily])

  function selectChartFamily(family: ChartFamily) {
    setChartFamily(family)
    const tabs = chartsByFamily(family)
    if (!tabs.some((c) => c.id === chartTab)) {
      setChartTab(tabs[0]?.id ?? DEFAULT_HEX_CHART_ID)
    }
  }

  useEffect(() => {
    if (!drawerOpen) return
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') setDrawerOpen(false)
    }
    window.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
    }
  }, [drawerOpen])

  // Calendar HEX day — no RPC. Tick every minute so day rolls over locally.
  useEffect(() => {
    function tick() {
      setHexDay(estimateHexDay())
    }
    tick()
    const id = window.setInterval(tick, 60_000)
    return () => window.clearInterval(id)
  }, [])

  function evaluateUpdateNeed(
    nextWatch: WatchedAddress[],
    nextSnaps: AddressSnapshot[],
    savedAt: string | null,
  ) {
    if (nextWatch.length === 0) {
      setAskUpdate(false)
      setUpdateReason(null)
      return 'idle' as const
    }
    const missing = missingWatchlistSnapshotsBoth(nextWatch, nextSnaps)
    if (missing.length > 0) {
      setAskUpdate(false)
      setUpdateReason(null)
      return 'index' as const
    }
    if (cacheIsStale(savedAt)) {
      setAskUpdate(true)
      setUpdateReason(
        savedAt
          ? `Local data from ${new Date(savedAt).toLocaleString()}. Update from chain?`
          : 'Local cache is stale. Update from chain?',
      )
      return 'stale' as const
    }
    setAskUpdate(false)
    setUpdateReason(null)
    return 'fresh' as const
  }

  // Restore local cache once. Auto-index only when nothing is cached yet.
  useEffect(() => {
    let cancelled = false
    const { snapshots: cached, savedAt } = pruneCachedSnapshotsBoth(watchlist)
    setSnapshots(cached)
    setCacheSavedAt(savedAt)
    const need = evaluateUpdateNeed(watchlist, cached, savedAt)
    if (need === 'index' && watchlist.length > 0) {
      void (async () => {
        if (cancelled) return
        await loadAll(watchlist)
      })()
    }
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // T-share board can refresh without a full stake reindex.
  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const quotes = await loadQuotesBoth()
        if (cancelled) return
        const board = await loadTshareBoth({
          ethereum: quotes.ethereum.hexUsd,
          pulsechain: quotes.pulsechain.hexUsd,
        })
        if (!cancelled) setTshareBoard(board)
      } catch {
        /* keep prior board */
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const scopedSnapshots = useMemo(
    () => (chain === 'all' ? snapshots : snapshots.filter((s) => s.chain === chain)),
    [snapshots, chain],
  )

  const liveDay = useMemo(() => {
    const cached = scopedSnapshots.reduce((max, s) => Math.max(max, s.currentDay || 0), 0)
    return Math.max(hexDay, cached)
  }, [hexDay, scopedSnapshots])

  const flatStakes = useMemo(() => {
    const rows: FlatStake[] = []
    for (const snap of scopedSnapshots) {
      const day = Math.max(hexDay, snap.currentDay || 0)
      const label =
        watchlist.find((w) => w.address.toLowerCase() === snap.address.toLowerCase())?.label ??
        snap.address
      for (const stake of snap.stakes) {
        const locked = BigInt(stake.lockedDay)
        const days = BigInt(stake.stakedDays)
        const unlocked = BigInt(stake.unlockedDay)
        const status = deriveStatus(BigInt(day), locked, days, unlocked)
        const endDay = stake.lockedDay + stake.stakedDays
        const graceEnd = endDay + 14
        const served = servedDays(BigInt(day), locked, days)
        const progressPct =
          days === 0n ? 0 : Math.min(100, Math.round((Number(served) / Number(days)) * 100))
        let daysLeft: number | null = null
        if (status === 'active' || status === 'scheduled') {
          daysLeft = Math.max(0, endDay - day)
        } else if (status === 'mature') {
          daysLeft = Math.max(0, graceEnd - day)
        } else if (status === 'late') {
          daysLeft = Math.max(0, day - graceEnd)
        }
        rows.push({
          key: `${snap.chain}-${snap.address}-${stake.stakeId}`,
          label,
          address: snap.address,
          chain: snap.chain,
          currentDay: day,
          stake: { ...stake, status, progressPct },
          endDay,
          daysLeft,
        })
      }
    }
    return rows.sort((a, b) => {
      if (a.stake.status !== b.stake.status) {
        const order: Record<StakeRow['status'], number> = {
          late: 0,
          mature: 1,
          active: 2,
          scheduled: 3,
          ended: 4,
        }
        return order[a.stake.status] - order[b.stake.status]
      }
      // Late: higher late-days first; others: soonest first.
      if (a.stake.status === 'late') {
        return (b.daysLeft ?? 0) - (a.daysLeft ?? 0)
      }
      return (a.daysLeft ?? 99999) - (b.daysLeft ?? 99999)
    })
  }, [scopedSnapshots, watchlist, hexDay])

  const addressOptions = useMemo(() => {
    const seen = new Map<
      string,
      { address: string; label: string; named: boolean; color: string }
    >()
    const push = (address: string, label: string) => {
      const key = address.toLowerCase()
      if (seen.has(key)) return
      seen.set(key, {
        address,
        label: walletDisplayName(label, address),
        named: hasCustomLabel(label, address),
        color: addressColor(address),
      })
    }
    for (const row of flatStakes) push(row.address, row.label)
    for (const entry of watchlist) push(entry.address, entry.label)
    return [...seen.values()]
  }, [flatStakes, watchlist])

  const filteredStakes = useMemo(() => {
    let rows =
      filter === 'all' ? [...flatStakes] : flatStakes.filter((r) => r.stake.status === filter)
    if (addrFilter !== 'all') {
      rows = rows.filter((r) => r.address.toLowerCase() === addrFilter)
    }
    if (monthFilter) {
      rows = rows.filter(
        (r) => r.stake.status !== 'ended' && maturityMonthKey(r.endDay) === monthFilter,
      )
    }
    rows.sort((a, b) => {
      if (sortBy === 'size') {
        return Number(b.stake.currentHex) - Number(a.stake.currentHex)
      }
      if (sortBy === 'start') {
        return a.stake.lockedDay - b.stake.lockedDay || a.endDay - b.endDay
      }
      if (sortBy === 'end') {
        return a.endDay - b.endDay || a.stake.lockedDay - b.stake.lockedDay
      }
      const order: Record<StakeRow['status'], number> = {
        late: 0,
        mature: 1,
        active: 2,
        scheduled: 3,
        ended: 4,
      }
      if (a.stake.status !== b.stake.status) {
        return order[a.stake.status] - order[b.stake.status]
      }
      if (a.stake.status === 'late') {
        return (b.daysLeft ?? 0) - (a.daysLeft ?? 0)
      }
      return (a.daysLeft ?? 99999) - (b.daysLeft ?? 99999)
    })
    return rows
  }, [flatStakes, filter, addrFilter, monthFilter, sortBy])

  const stats = useMemo(() => {
    const liquid = scopedSnapshots.reduce((sum, s) => sum + Number(s.liquidHex || 0), 0)
    const principal = flatStakes
      .filter((r) => r.stake.status !== 'ended')
      .reduce((sum, r) => sum + Number(r.stake.stakedHex || 0), 0)
    const hdrnSum = (chainKey: 'ethereum' | 'pulsechain') =>
      flatStakes
        .filter((r) => r.chain === chainKey && hdrnWorthMinting(r.stake, r.chain))
        .reduce((sum, r) => {
          if (r.stake.hdrnLoaned) return sum
          const n = Number(r.stake.hdrnClaimable)
          return sum + (Number.isFinite(n) ? n : 0)
        }, 0)
    const hdrnEth = hdrnSum('ethereum')
    const hdrnPls = hdrnSum('pulsechain')
    const hdrn = chain === 'ethereum' ? hdrnEth : chain === 'pulsechain' ? hdrnPls : hdrnEth + hdrnPls
    const active = flatStakes.filter((r) => r.stake.status === 'active').length
    const mature = flatStakes.filter((r) => r.stake.status === 'mature').length
    const late = flatStakes.filter((r) => r.stake.status === 'late').length
    // Prefer stakes that need action (late → mature). Active "Xd left" is not action.
    const nearest =
      flatStakes.find((r) => r.stake.status === 'late') ??
      flatStakes.find((r) => r.stake.status === 'mature')
    const observedAt = cacheSavedAt ?? scopedSnapshots[0]?.observedAt ?? null

    const open = flatStakes.filter((r) => r.stake.status !== 'ended')
    let tshares = 0
    let costTotal = 0
    let costCount = 0
    let markedTotal = 0
    let markedCount = 0
    let pnlTotal = 0
    let pnlCount = 0
    for (const r of open) {
      tshares += sharesToTshares(r.stake.shares)
      const now = parseMoney(r.stake.currentUsd)
      const start = parseMoney(r.stake.startUsd)
      if (now != null && start != null) {
        markedTotal += now - start
        markedCount += 1
      }
      const cost = getCostBasis(costBasis, r.chain, r.stake.stakeId)
      if (cost != null) {
        costTotal += cost
        costCount += 1
        if (now != null) {
          pnlTotal += now - cost
          pnlCount += 1
        }
      }
    }

    const tshareSnapFor = (key: ChainKey): TshareSnap | null => tshareBoard?.[key] ?? null
    const tshareEth = tshareSnapFor('ethereum')
    const tsharePls = tshareSnapFor('pulsechain')
    const tshareActive =
      chain === 'ethereum' ? tshareEth : chain === 'pulsechain' ? tsharePls : null
    const tshareOwnedUsd =
      chain === 'all'
        ? (() => {
            let sum = 0
            let any = false
            for (const r of open) {
              const snap = tshareSnapFor(r.chain)
              const ts = sharesToTshares(r.stake.shares)
              if (snap?.usdPerTshare != null && ts > 0) {
                sum += ts * snap.usdPerTshare
                any = true
              }
            }
            return any ? sum : null
          })()
        : tshareActive?.usdPerTshare != null
          ? tshares * tshareActive.usdPerTshare
          : null

    return {
      liquid,
      principal,
      hdrn,
      hdrnEth,
      hdrnPls,
      active,
      mature,
      late,
      nearest,
      day: liveDay,
      observedAt,
      tshares,
      tshareOwnedUsd,
      tshareEth,
      tsharePls,
      tshareActive,
      costTotal: costCount ? costTotal : null,
      costCount,
      markedYield: markedCount ? markedTotal : null,
      pnl: pnlCount ? pnlTotal : null,
      pnlCount,
      maturity: maturityCalendar(flatStakes),
    }
  }, [scopedSnapshots, flatStakes, liveDay, cacheSavedAt, chain, costBasis, tshareBoard])

  function persist(next: WatchedAddress[]) {
    setWatchlist(next)
    saveWatchlist(next)
    const pruned = pruneCachedSnapshotsBoth(next)
    setSnapshots(pruned.snapshots)
    setCacheSavedAt(pruned.savedAt)
    return evaluateUpdateNeed(next, pruned.snapshots, pruned.savedAt)
  }

  function setStakeCost(chainKey: ChainKey, stakeId: number, usd: number | null) {
    setCostBasis((prev) => setCostBasisEntry(prev, chainKey, stakeId, usd))
  }

  function openMaturityMonth(key: string) {
    setMonthFilter(key)
    setFilter('all')
    setSortBy('end')
    go('stakes')
  }

  function exportLocalBackup() {
    const payload = buildLocalBackup(watchlist, costBasis)
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `hex-watch-backup-${new Date().toISOString().slice(0, 10)}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  async function importLocalBackup(file: File) {
    setFormError(null)
    try {
      const text = await file.text()
      let raw: unknown
      try {
        raw = JSON.parse(text)
      } catch {
        throw new Error('Could not read that JSON file.')
      }
      const backup = parseLocalBackup(raw)
      const hasWatch = backup.watchlist.length > 0
      const hasCost = Object.keys(backup.costBasis).length > 0
      if (!hasWatch && !hasCost) {
        throw new Error('Backup is empty.')
      }
      const ok = window.confirm(
        hasWatch
          ? `Replace local watchlist (${backup.watchlist.length} address${
              backup.watchlist.length === 1 ? '' : 'es'
            }) and cost basis?`
          : 'Replace local cost basis from this file?',
      )
      if (!ok) return

      if (hasWatch) {
        const need = persist(backup.watchlist)
        setCostBasis(replaceCostBasis(backup.costBasis))
        setAddrFilter('all')
        go('overview')
        if (need === 'index') await loadAll(backup.watchlist)
        else setAskUpdate(true)
      } else {
        setCostBasis(replaceCostBasis(backup.costBasis))
      }
    } catch (error) {
      setFormError(error instanceof Error ? error.message : 'Import failed.')
    }
  }

  async function loadAll(entries: WatchedAddress[]) {
    if (syncingRef.current) return
    if (entries.length === 0) {
      setSnapshots([])
      for (const key of BOTH_CHAINS) saveCachedSnapshots(key, [])
      setCacheSavedAt(new Date().toISOString())
      setAskUpdate(false)
      setUpdateReason(null)
      return
    }
    syncingRef.current = true
    setLoading(true)
    setLoadError(null)
    setAskUpdate(false)
    setUpdateReason(null)
    try {
      const quotesByChain = await loadQuotesBoth()
      const board = await loadGasBoard({
        ...quotesByChain.ethereum,
        plsUsd: quotesByChain.pulsechain.plsUsd,
        source: `${quotesByChain.ethereum.source} + ${quotesByChain.pulsechain.source}`,
      })
      setGasBoard(board)

      try {
        const tshare = await loadTshareBoth({
          ethereum: quotesByChain.ethereum.hexUsd,
          pulsechain: quotesByChain.pulsechain.hexUsd,
        })
        setTshareBoard(tshare)
      } catch {
        /* keep prior */
      }

      // Buffer both chains fully before writing cache — avoids half-fresh disk state.
      const byChain: Record<ChainKey, AddressSnapshot[]> = {
        ethereum: [],
        pulsechain: [],
      }
      const errors: string[] = []
      for (const key of BOTH_CHAINS) {
        for (const entry of entries) {
          try {
            byChain[key].push(
              await loadSnapshot(key, entry.address, board, quotesByChain[key]),
            )
          } catch (error) {
            errors.push(
              `${CHAINS[key].label} ${entry.address.slice(0, 6)}…: ${
                error instanceof Error ? error.message : String(error)
              }`,
            )
          }
        }
      }

      if (byChain.ethereum.length === 0 && byChain.pulsechain.length === 0) {
        throw new Error(errors[0] ?? 'Refresh failed on both chains.')
      }

      const savedAt = new Date().toISOString()
      for (const key of BOTH_CHAINS) {
        if (byChain[key].length === entries.length) {
          saveCachedSnapshots(key, byChain[key], savedAt)
        }
      }
      const next = [...byChain.ethereum, ...byChain.pulsechain]
      setSnapshots(next)
      setCacheSavedAt(savedAt)
      const maxDay = next.reduce((m, s) => Math.max(m, s.currentDay || 0), 0)
      if (maxDay) setHexDay(Math.max(estimateHexDay(), maxDay))
      setAskUpdate(false)
      setUpdateReason(null)
      if (errors.length) {
        setLoadError(`Partial sync · ${errors.slice(0, 2).join(' · ')}`)
      }
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : 'Refresh failed.')
      evaluateUpdateNeed(entries, snapshots, cacheSavedAt)
    } finally {
      syncingRef.current = false
      setLoading(false)
    }
  }

  async function addAddress(event: FormEvent) {
    event.preventDefault()
    setFormError(null)
    try {
      const address = normalizeAddress(addressInput)
      if (watchlist.some((entry) => entry.address.toLowerCase() === address.toLowerCase())) {
        throw new Error('That address is already on your list.')
      }
      const entry: WatchedAddress = {
        id: crypto.randomUUID(),
        address,
        label: labelInput.trim() || `${address.slice(0, 6)}…${address.slice(-4)}`,
        createdAt: new Date().toISOString(),
      }
      const next = [entry, ...watchlist]
      const need = persist(next)
      setAddressInput('')
      setLabelInput('')
      go('overview')
      if (need === 'index') await loadAll(next)
    } catch (error) {
      setFormError(error instanceof Error ? error.message : 'Could not add address.')
    }
  }

  function removeAddress(id: string) {
    const doomed = watchlist.find((entry) => entry.id === id)
    const next = watchlist.filter((entry) => entry.id !== id)
    persist(next)
    if (doomed && addrFilter === doomed.address.toLowerCase()) setAddrFilter('all')
  }

  function loadDemos() {
    const next = installDemoWatchlist(watchlist)
    const need = persist(next)
    if (need === 'index') void loadAll(next)
    else setAskUpdate(true)
  }

  function clearDemos() {
    const next = clearDemoWatchlist(watchlist)
    persist(next)
    if (addrFilter !== 'all' && next.every((e) => e.address.toLowerCase() !== addrFilter)) {
      setAddrFilter('all')
    }
  }

  async function refresh() {
    if (watchlist.length === 0) {
      setSnapshots([])
      setLoadError('Add at least one public address first.')
      go('addresses')
      return
    }
    await loadAll(watchlist)
    setDrawerOpen(false)
  }

  async function pullRefresh() {
    if (watchlist.length === 0) return
    await loadAll(watchlist)
  }

  const ptr = usePullToRefresh(pullRefresh, drawerOpen || loading)

  function go(next: View) {
    setView(next)
    if (next !== 'stakes') {
      setChain('all')
      setMonthFilter(null)
    }
    setDrawerOpen(false)
    const nextHash = hashForView(next)
    if (window.location.hash !== nextHash) {
      window.history.pushState(null, '', nextHash)
    }
  }

  useEffect(() => {
    function onHash() {
      setView(viewFromHash())
    }
    window.addEventListener('hashchange', onHash)
    window.addEventListener('popstate', onHash)
    if (!window.location.hash) {
      window.history.replaceState(null, '', hashForView(view))
    }
    return () => {
      window.removeEventListener('hashchange', onHash)
      window.removeEventListener('popstate', onHash)
    }
  }, [])

  function dismissUpdate() {
    setAskUpdate(false)
  }

  return (
    <div className="app">
      <HexBackdrop />

      <header className="topbar">
        <button
          type="button"
          className={`menu-btn${drawerOpen ? ' is-open' : ''}`}
          aria-label="Menu"
          aria-expanded={drawerOpen}
          aria-controls="app-drawer"
          onClick={() => setDrawerOpen(true)}
        >
          <svg className="menu-btn-hex" viewBox="0 0 44 38" aria-hidden="true">
            <defs>
              <linearGradient id="menu-hex-grad" x1="12%" y1="8%" x2="88%" y2="92%">
                <stop offset="0%" stopColor="#FE01FA" />
                <stop offset="32%" stopColor="#FF0F6F" />
                <stop offset="52%" stopColor="#FF3D3D" />
                <stop offset="71%" stopColor="#FF851F" />
                <stop offset="100%" stopColor="#FFDB01" />
              </linearGradient>
            </defs>
            {/* Regular flat-top hexagon */}
            <polygon
              className="menu-btn-face"
              points="13,3.5 31,3.5 40,19 31,34.5 13,34.5 4,19"
            />
            <g className="menu-btn-lines">
              <rect className="menu-btn-line top" x="15" y="13.5" width="14" height="2" rx="1" />
              <rect className="menu-btn-line mid" x="15" y="18" width="14" height="2" rx="1" />
              <rect className="menu-btn-line bot" x="15" y="22.5" width="14" height="2" rx="1" />
            </g>
          </svg>
        </button>

        <div className="brand-block">
          <button type="button" className="brand" onClick={() => go('overview')}>
            <img className="brand-logo" src="/brand/HEXagon.svg" alt="" />
            <span className="brand-title">HEX Watch</span>
          </button>
          <ThinkingEyebrow
            text={`${chainMeta.label}${loading ? ' · reading…' : cacheSavedAt ? ' · local cache' : ''}`}
            thinking={loading}
          />
        </div>

        <p
          className="hex-day"
          title={`${chainMeta.label} HEX day ${stats.day} · ${formatDayDate(stats.day)} UTC · calendar (no RPC)`}
        >
          <span>Day</span>
          <strong>{stats.day}</strong>
        </p>
      </header>

      <div
        className={`ptr${ptr.refreshing || ptr.pull > 8 ? ' is-on' : ''}${ptr.armed ? ' is-armed' : ''}`}
        style={{ height: ptr.refreshing ? 44 : ptr.pull }}
        aria-hidden="true"
      >
        <span>{ptr.refreshing ? 'Syncing…' : ptr.armed ? 'Release to update' : 'Pull to update'}</span>
      </div>

      <div
        className={`drawer-root${drawerOpen ? ' is-open' : ''}`}
        aria-hidden={!drawerOpen}
      >
        <button
          type="button"
          className="drawer-scrim"
          tabIndex={drawerOpen ? 0 : -1}
          aria-label="Close menu"
          onClick={() => setDrawerOpen(false)}
        />
        <aside id="app-drawer" className="drawer" role="dialog" aria-modal="true" aria-label="Menu">
          <div className="drawer-head">
            <p className="drawer-brand">
              <img className="brand-logo" src="/brand/HEXagon.svg" alt="" />
              <span className="brand-title">HEX Watch</span>
            </p>
            <button type="button" className="ghost drawer-close" onClick={() => setDrawerOpen(false)}>
              Close
            </button>
          </div>

          <nav className="drawer-nav" aria-label="Primary">
            {(
              [
                ['overview', 'Overview'],
                ['stakes', 'Mining'],
                ['chart', 'Chart'],
                ['addresses', 'Addresses'],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                className={view === id ? 'active' : ''}
                onClick={() => go(id)}
              >
                {label}
              </button>
            ))}
          </nav>

          <nav className="drawer-links" aria-label="HEX, PulseX, and Richard Heart">
            <p className="eyebrow">Stake / swap</p>
            <a href="https://go.hex.com/" target="_blank" rel="noreferrer">
              go.HEX
            </a>
            <a href="https://hex.com/" target="_blank" rel="noreferrer">
              HEX.COM
            </a>
            <a href="https://pulsex.com/" target="_blank" rel="noreferrer">
              PulseX
            </a>
            <p className="eyebrow">Richard Heart</p>
            <a href="https://x.com/RichardHeartWin" target="_blank" rel="noreferrer">
              X · @RichardHeartWin
            </a>
            <a
              href="https://www.youtube.com/channel/UCta3TYFhzfpPvOtKBDifYJA/videos"
              target="_blank"
              rel="noreferrer"
            >
              YouTube · Videos
            </a>
            <a
              href="https://www.youtube.com/channel/UCta3TYFhzfpPvOtKBDifYJA/streams"
              target="_blank"
              rel="noreferrer"
            >
              YouTube · Live
            </a>
          </nav>
        </aside>
      </div>

      <main className="main">
        {loadError && (
          <p className="banner error" role="alert">
            {loadError}
          </p>
        )}

        {askUpdate && updateReason && !loading && (
          <div className="banner update-ask" role="status">
            <p>{updateReason}</p>
            <div className="empty-actions">
              <button className="cta" type="button" onClick={() => void refresh()} disabled={loading}>
                Update from chain
              </button>
              <button type="button" className="text-link" onClick={dismissUpdate}>
                Not now
              </button>
            </div>
          </div>
        )}

        {view === 'overview' && (
          <section className="view overview-view">
            {watchlistHasDemos(watchlist) ? (
              <div className="banner demo-ask" role="status">
                <p>Public demo wallets are loaded — not your addresses.</p>
                <div className="empty-actions">
                  <button type="button" className="ghost" onClick={clearDemos}>
                    Clear demos
                  </button>
                  <button type="button" className="text-link" onClick={() => go('addresses')}>
                    Add yours →
                  </button>
                </div>
              </div>
            ) : null}

            {scopedSnapshots.length > 0 ? (
              <>
              <div className="metric-row" aria-label="Snapshot">
                <div>
                  <span>Liquid HEX</span>
                  <strong>{formatHex(String(stats.liquid))}</strong>
                </div>
                <div>
                  <span>Staked principal</span>
                  <strong>{formatHex(String(stats.principal))}</strong>
                </div>
                <div>
                  <span>HDRN mintable</span>
                  <strong>
                    {chain === 'all' ? (
                      <>
                        PLS {formatHdrn(String(stats.hdrnPls))}
                        <em> / ETH {formatHdrn(String(stats.hdrnEth))}</em>
                      </>
                    ) : (
                      formatHdrn(String(stats.hdrn))
                    )}
                  </strong>
                </div>
                <div>
                  <span>Active / mature / late</span>
                  <strong>
                    {stats.active}
                    <em>
                      {' '}
                      / {stats.mature} / {stats.late}
                    </em>
                  </strong>
                </div>
                <div>
                  <span>Needs action</span>
                  <strong>
                    {stats.nearest
                      ? stats.nearest.stake.status === 'late'
                        ? `late ${stats.nearest.daysLeft}d`
                        : `grace ${stats.nearest.daysLeft}d`
                      : '—'}
                  </strong>
                </div>
                <div
                  title={`${gasCompare.premiumLabel}\nETH ${gasCompare.ethGwei} · PLS ${gasCompare.plsGwei} · ~140k gas`}
                >
                  <span>Unstake gas</span>
                  <strong>
                    {gasCompare.ethUsd}
                    <em>
                      {' '}
                      / {gasCompare.plsUsd} · ETH {gasCompare.ratioLabel} PLS
                    </em>
                  </strong>
                </div>
              </div>

              <div className="analyst-strip" aria-label="Analyst snapshot">
                <div className="analyst-block tshare-block">
                  <h3>T-Shares</h3>
                  <p className="analyst-lead">
                    <strong>{formatTshareCount(stats.tshares)}</strong>
                    <em>
                      {' '}
                      owned
                      {stats.tshareOwnedUsd != null
                        ? ` · ${fmtTshareUsd(stats.tshareOwnedUsd)}`
                        : ''}
                    </em>
                  </p>
                  {chain === 'all' ? (
                    <ul className="tshare-chain-list">
                      {(
                        [
                          ['pulsechain', 'PLS', stats.tsharePls],
                          ['ethereum', 'ETH', stats.tshareEth],
                        ] as const
                      ).map(([key, label, snap]) => (
                        <li key={key}>
                          <span>{label}</span>
                          <strong>
                            {fmtTshareUsd(snap?.usdPerTshare ?? null)}
                            <em>
                              {' '}
                              / T · day {fmtTshareHex(snap?.payoutHex ?? null)} HEX
                            </em>
                          </strong>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="analyst-sub">
                      1 T-Share {fmtTshareUsd(stats.tshareActive?.usdPerTshare ?? null)}
                      <em>
                        {' '}
                        · prior day {fmtTshareHex(stats.tshareActive?.payoutHex ?? null)} HEX
                        {stats.tshareActive?.payoutUsd != null
                          ? ` (${fmtTshareUsd(stats.tshareActive.payoutUsd)})`
                          : ''}
                      </em>
                    </p>
                  )}
                </div>

                <div className="analyst-block pnl-block">
                  <h3>Cost &amp; P&amp;L</h3>
                  <p className="analyst-lead">
                    <strong>
                      {stats.pnl != null ? formatSignedUsd(stats.pnl) : '—'}
                    </strong>
                    <em>
                      {' '}
                      vs cost
                      {stats.costCount
                        ? ` · ${stats.costCount} stake${stats.costCount === 1 ? '' : 's'}`
                        : ' · set cost on a stake'}
                    </em>
                  </p>
                  <p className="analyst-sub">
                    Cost {stats.costTotal != null ? money(stats.costTotal) : '—'}
                    <em>
                      {' '}
                      · marked yield {formatSignedUsd(stats.markedYield)}
                    </em>
                  </p>
                </div>

                <div className="analyst-block maturity-block">
                  <h3>Maturity</h3>
                  {stats.maturity.length === 0 ? (
                    <p className="analyst-sub">No open stakes.</p>
                  ) : (
                    <ul className="maturity-list">
                      {stats.maturity.map((bucket) => (
                        <li key={bucket.key}>
                          <button
                            type="button"
                            className="maturity-jump"
                            onClick={() => openMaturityMonth(bucket.key)}
                          >
                            <span>{bucket.label}</span>
                            <strong>
                              {bucket.count}
                              <em>
                                {' '}
                                · {formatHex(String(bucket.hex))} HEX
                              </em>
                            </strong>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
              </>
            ) : null}

            {watchlist.length === 0 ? (
              <div className="empty-state">
                <h2>No addresses yet</h2>
                <p>Add a public HEX address, or load public demo wallets to try the board.</p>
                <div className="empty-actions">
                  <button type="button" className="cta" onClick={() => go('addresses')}>
                    Add addresses
                  </button>
                  <button type="button" className="ghost" onClick={loadDemos}>
                    Load demos
                  </button>
                </div>
              </div>
            ) : loading && scopedSnapshots.length === 0 ? (
              <div className="empty-state">
                <h2>Reading chain…</h2>
                <p>Fetching stakes for {watchlist.length} watched address{watchlist.length === 1 ? '' : 'es'}.</p>
              </div>
            ) : scopedSnapshots.length === 0 ? (
              <div className="empty-state">
                <h2>No chain read yet</h2>
                <p>Addresses are saved locally. Update from chain when you want stake data.</p>
                <div className="empty-actions">
                  <button className="cta" type="button" onClick={() => void refresh()} disabled={loading}>
                    {loading ? 'Syncing…' : 'Update from chain'}
                  </button>
                </div>
              </div>
            ) : flatStakes.length === 0 && !loading ? (
              <div className="empty-state">
                <h2>No stakes on {chainMeta.label}</h2>
                <p>
                  {scopedSnapshots.length} watched address
                  {scopedSnapshots.length === 1 ? '' : 'es'} returned stakeCount 0.
                </p>
              </div>
            ) : flatStakes.length === 0 && loading ? (
              <div className="empty-state">
                <h2>Updating…</h2>
                <p>Refreshing stake data from chain.</p>
              </div>
            ) : (
              <>
                <div className="section-head">
                  <h2>Stakes</h2>
                  <button type="button" className="text-link" onClick={() => go('stakes')}>
                    Full ledger →
                  </button>
                </div>
                <div className="stake-stack">
                  {flatStakes.slice(0, 6).map((row, i) => (
                    <StakeCard
                      key={row.key}
                      row={row}
                      i={i}
                      costUsd={getCostBasis(costBasis, row.chain, row.stake.stakeId)}
                      onSetCost={(usd) => setStakeCost(row.chain, row.stake.stakeId, usd)}
                    />
                  ))}
                </div>
              </>
            )}
          </section>
        )}

        {view === 'stakes' && (
          <section className="view mining-view">
            <div className="tab-bar" role="tablist" aria-label="Network">
              {(
                [
                  ['all', 'All'],
                  ['ethereum', 'ETH'],
                  ['pulsechain', 'PLS'],
                ] as const
              ).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  role="tab"
                  aria-selected={chain === id}
                  className={chain === id ? 'active' : ''}
                  onClick={() => setChain(id)}
                >
                  {id === 'ethereum' ? (
                    <img className="chain-icon eth" src="/brand/eth.svg" alt="" />
                  ) : null}
                  {id === 'pulsechain' ? (
                    <img className="chain-icon pls" src="/brand/pls.png" alt="" />
                  ) : null}
                  {label}
                </button>
              ))}
            </div>
            <div className="tab-bar tab-bar-status" role="tablist" aria-label="Status">
              {(['all', 'active', 'mature', 'late', 'ended'] as const).map((id) => (
                <button
                  key={id}
                  type="button"
                  role="tab"
                  aria-selected={filter === id}
                  className={filter === id ? 'active' : ''}
                  onClick={() => setFilter(id)}
                >
                  {id === 'all' ? 'All' : id}
                </button>
              ))}
            </div>
            <div className="ledger-tools">
              <label>
                Wallet
                <select
                  value={addrFilter}
                  onChange={(e) => setAddrFilter(e.target.value as 'all' | string)}
                >
                  <option value="all">All wallets</option>
                  {addressOptions.map((opt) => (
                    <option key={opt.address} value={opt.address.toLowerCase()}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Sort
                <select value={sortBy} onChange={(e) => setSortBy(e.target.value as SortKey)}>
                  <option value="soonest">Soonest</option>
                  <option value="size">Size</option>
                  <option value="start">Start</option>
                  <option value="end">End</option>
                </select>
              </label>
            </div>

            {monthFilter ? (
              <div className="filter-chip-row" role="status">
                <span>
                  Maturity{' '}
                  {stats.maturity.find((b) => b.key === monthFilter)?.label ?? monthFilter}
                </span>
                <button type="button" className="text-link" onClick={() => setMonthFilter(null)}>
                  Clear
                </button>
              </div>
            ) : null}

            {filteredStakes.length === 0 ? (
              <p className="empty-inline">
                {flatStakes.length === 0
                  ? `No stakes on ${chainMeta.label}.`
                  : 'No stakes match these filters.'}
              </p>
            ) : (
              <div className="stake-stack">
                {filteredStakes.map((row, i) => (
                  <StakeCard
                    key={row.key}
                    row={row}
                    i={i}
                    costUsd={getCostBasis(costBasis, row.chain, row.stake.stakeId)}
                    onSetCost={(usd) => setStakeCost(row.chain, row.stake.stakeId, usd)}
                  />
                ))}
              </div>
            )}
          </section>
        )}

        {view === 'chart' && (
          <section className="view chart-view">
            <div className="chart-tab-groups">
              <div
                className="tab-bar chart-family-tabs"
                role="tablist"
                aria-label="Chart family"
              >
                {CHART_FAMILY_ROWS.map((row) => (
                  <button
                    key={row.family}
                    type="button"
                    role="tab"
                    aria-selected={chartFamily === row.family}
                    className={chartFamily === row.family ? 'active' : ''}
                    onClick={() => selectChartFamily(row.family)}
                  >
                    {row.label}
                  </button>
                ))}
              </div>
              <div
                className={`tab-bar chart-pair-tabs chart-pair-tabs-${chartFamily}`}
                role="tablist"
                aria-label={CHART_FAMILY_ROWS.find((r) => r.family === chartFamily)?.aria}
              >
                {familyPairTabs.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    role="tab"
                    aria-selected={chartTab === c.id}
                    className={chartTab === c.id ? 'active' : ''}
                    onClick={() => setChartTab(c.id)}
                    title={`${c.blurb} · ${c.dex}${c.chain === 'ethereum' ? ' · ETH' : ' · Pulse'}`}
                  >
                    {c.label}
                  </button>
                ))}
              </div>
            </div>

            {activeChart.source === 'hexchart' ? (
              <EhexLogChart key={activeChart.id} />
            ) : (
              <iframe
                key={activeChart.id}
                className="chart-embed"
                title={`${activeChart.label} — ${activeChart.dex}`}
                src={chartEmbedUrl(activeChart)}
                loading="lazy"
                allow="clipboard-write; fullscreen"
                referrerPolicy="no-referrer-when-downgrade"
              />
            )}
            <p className="chart-footnote">
              <span className="chart-footnote-meta">
                {activeChart.chain === 'ethereum' ? 'ETH' : 'Pulse'} · {activeChart.dex} ·{' '}
                {activeChart.blurb}
              </span>
              {' · '}
              <a href={chartPageUrl(activeChart)} target="_blank" rel="noreferrer">
                Open full chart →
              </a>
            </p>
          </section>
        )}

        {view === 'addresses' && (
          <section className="view">
            <h1 className="line-title">
              Watchlist
              <em>Local only</em>
            </h1>

            <form className="watch-form" onSubmit={addAddress}>
              <input
                value={addressInput}
                onChange={(e) => setAddressInput(e.target.value)}
                placeholder="0x…"
                aria-label="Public address"
                autoComplete="off"
                spellCheck={false}
              />
              <input
                value={labelInput}
                onChange={(e) => setLabelInput(e.target.value)}
                placeholder="Label"
                aria-label="Label"
                maxLength={64}
              />
              <button className="cta" type="submit">
                Add
              </button>
              {formError && (
                <p className="banner error" role="alert">
                  {formError}
                </p>
              )}
            </form>

            <div className="watch-tools">
              <button
                type="button"
                className="ghost"
                onClick={exportLocalBackup}
                disabled={watchlist.length === 0 && Object.keys(costBasis).length === 0}
              >
                Export JSON
              </button>
              <button
                type="button"
                className="ghost"
                onClick={() => importFileRef.current?.click()}
              >
                Import JSON
              </button>
              <input
                ref={importFileRef}
                type="file"
                accept="application/json,.json"
                hidden
                onChange={(e) => {
                  const file = e.target.files?.[0]
                  e.target.value = ''
                  if (file) void importLocalBackup(file)
                }}
              />
              <span className="watch-tools-hint">
                Watchlist + cost basis · import replaces local data
              </span>
            </div>

            <ul className="watch-list">
              {watchlist.map((entry) => (
                <li key={entry.id}>
                  <div>
                    <strong>
                      <i
                        className="addr-dot"
                        style={{ background: addressColor(entry.address) }}
                        aria-hidden="true"
                      />
                      {entry.label}
                    </strong>
                    <code>{entry.address}</code>
                  </div>
                  <button type="button" className="ghost" onClick={() => removeAddress(entry.id)}>
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}
      </main>
    </div>
  )
}
