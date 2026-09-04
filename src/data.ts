import {
  createPublicClient,
  encodeFunctionData,
  formatEther,
  formatUnits,
  http,
  isAddress,
  getAddress,
  type Address,
  type PublicClient,
} from 'viem'
import { mainnet } from 'viem/chains'
import {
  CHAINS,
  COM_ADDRESS,
  COM_DECIMALS,
  COM_READ_ABI,
  HDRN_ADDRESS,
  HDRN_READ_ABI,
  HEX_ADDRESS,
  HEX_READ_ABI,
  HSI_ABI,
  HSIM_ABI,
  HSIM_ADDRESS,
  type ChainKey,
} from './hex'
import {
  annualizedPct,
  decodeDailyPayout,
  deriveStatus,
  estimateEarlyPenalty,
  estimateLatePenalty,
  formatDayDate,
  servedDays,
  type StakeStatus,
} from './hexMath'
import { loadQuotes, type QuoteSet } from './quotes'
import { formatGasCompare, type GasBoard } from './gasBoard'

const pulsechain = {
  id: 369,
  name: 'PulseChain',
  nativeCurrency: { name: 'Pulse', symbol: 'PLS', decimals: 18 },
  rpcUrls: { default: { http: ['https://rpc.pulsechain.com'] } },
} as const

const DAILY_BATCH = 180n

export interface WatchedAddress {
  id: string
  address: Address
  label: string
  createdAt: string
}

export interface StakeRow {
  index: number
  stakeId: number
  stakedHearts: string
  stakedHex: string
  shares: string
  lockedDay: number
  stakedDays: number
  unlockedDay: number
  isAutoStake: boolean
  status: StakeStatus
  progressPct: number
  startDate: string
  endDate: string
  graceEndDate: string
  payoutHex: string
  currentHex: string
  startUsd: string
  currentUsd: string
  startEth: string
  currentEth: string
  currentPls: string
  apy: string
  penaltyHex: string
  ifEndedHex: string
  hsi: string | null
  hdrnClaimable: string
  hdrnClaimableUsd: string
  hdrnMintedDays: number
  hdrnLaunchBonus: number
  hdrnLoaned: boolean
  /** Communis start/end bonus still claimable (0 if none / already minted / ineligible). */
  comClaimable: string
  comClaimableUsd: string
  comClaimKind: 'start' | 'end' | null
  gasNative: string
  gasUsd: string
  gasNote: string
  gasEthUsd: string
  gasPlsUsd: string
  gasPremium: string
  /** True when reconstructed from StakeEnd/StakeStart logs (not live stakeLists). */
  historical?: boolean
}

export interface AddressSnapshot {
  chain: ChainKey
  address: Address
  currentDay: number
  liquidHex: string
  stakes: StakeRow[]
  hsiCount: number
  observedAt: string
  rpcUsed: string
  quoteSource: string
}

const STORAGE_KEY = 'hex-watch/watchlist/v1'
const SAMPLE_SEED_KEY = 'hex-watch/sample-seed/v6'

const SNAPSHOT_CACHE_KEY = 'hex-watch/snapshots/v5'
export const CACHE_STALE_MS = 12 * 60 * 60 * 1000
export const BOTH_CHAINS: ChainKey[] = ['ethereum', 'pulsechain']

interface SnapshotCacheFile {
  version: 1
  byChain: Partial<Record<ChainKey, { savedAt: string; snapshots: AddressSnapshot[] }>>
}

/**
 * Public sample wallets with live stakes.
 * ETH: native stake on Ac051… + 2 HSIs on 7Bc3…
 * Pulse: HSI / multi-stake wallets from recent StakeStart logs.
 */
const SAMPLE_STAKERS: { address: Address; label: string }[] = [
  { address: '0x7Bc305aDd61a819C139FC78852896e6871219750', label: 'HSI owner' },
  { address: '0xAc051F33b50Df8fEfB131312E1C3eC9682C0b60B', label: 'ETH native' },
  { address: '0x0aF25044F535566B1300235FC5c2368f21578D1f', label: 'Pulse wallet A' },
  { address: '0x6Fc1081eF00c83dDD831BE1E81145c06C3DE942c', label: 'Pulse wallet B' },
  { address: '0x9eF8D25059c130eDE89A17b15cc32D6057839425', label: 'Pulse multi' },
  { address: '0xB591aCcF75cF5eEF0a1B22859c2c827DdcF2BA93', label: 'Pulse wallet C' },
]

/** Older seed that may still sit in localStorage. */
const LEGACY_SAMPLE_LABELS: Record<string, string> = {
  '0x0347b27ec362bd03d475155b696f9cd696b4aefa': 'Pulse wallet D',
}

function shortWatchLabel(address: string) {
  return `${address.slice(0, 6)}…${address.slice(-4)}`
}

function isPlaceholderWatchLabel(label: string, address: string) {
  const short = shortWatchLabel(address)
  const trimmed = label.trim()
  if (!trimmed) return true
  if (trimmed === short || trimmed.toLowerCase() === address.toLowerCase()) return true
  if (/^sample\b/i.test(trimmed)) return true
  return false
}

function sampleLabelFor(address: string): string | undefined {
  const key = address.toLowerCase()
  const hit = SAMPLE_STAKERS.find((s) => s.address.toLowerCase() === key)
  if (hit?.label) return hit.label
  return LEGACY_SAMPLE_LABELS[key]
}

export function loadWatchlist(): WatchedAddress[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as WatchedAddress[]
    if (!Array.isArray(parsed)) return []
    return parsed.filter((item) => isAddress(item.address))
  } catch {
    return []
  }
}

/** Apply sample nicknames when the stored label is still a placeholder. */
function withSampleNames(list: WatchedAddress[]): { list: WatchedAddress[]; dirty: boolean } {
  let dirty = false
  const next = list.map((entry) => {
    if (!isPlaceholderWatchLabel(entry.label, entry.address)) return entry
    const want = sampleLabelFor(entry.address)
    if (!want || want === entry.label) return entry
    dirty = true
    return { ...entry, label: want }
  })
  return { list: next, dirty }
}

const SAMPLE_ADDRS = new Set([
  ...SAMPLE_STAKERS.map((s) => s.address.toLowerCase()),
  ...Object.keys(LEGACY_SAMPLE_LABELS),
])

export function isDemoWatchAddress(address: string): boolean {
  return SAMPLE_ADDRS.has(address.toLowerCase())
}

export function watchlistHasDemos(list: WatchedAddress[]): boolean {
  return list.some((e) => isDemoWatchAddress(e.address))
}

/**
 * Load watchlist only — no silent sample inject.
 * Still refreshes demo nicknames when labels are placeholders.
 */
export function seedSampleWatchlist(): WatchedAddress[] {
  const existing = loadWatchlist()
  const named = withSampleNames(existing)
  if (named.dirty) saveWatchlist(named.list)
  return named.list
}

/** Opt-in: add public demo stakers (and mark seed so we can disclose them). */
export function installDemoWatchlist(existing: WatchedAddress[] = loadWatchlist()): WatchedAddress[] {
  const named = withSampleNames(existing)
  const known = new Set(named.list.map((e) => e.address.toLowerCase()))
  const added: WatchedAddress[] = []
  const now = new Date().toISOString()
  for (const sample of SAMPLE_STAKERS) {
    if (known.has(sample.address.toLowerCase())) continue
    added.push({
      id: crypto.randomUUID(),
      address: sample.address,
      label: sample.label || shortWatchLabel(sample.address),
      createdAt: now,
    })
  }
  const next = [...added, ...named.list]
  saveWatchlist(next)
  localStorage.setItem(SAMPLE_SEED_KEY, '1')
  return next
}

/** Remove demo wallets from the watchlist (keeps any real addresses). */
export function clearDemoWatchlist(existing: WatchedAddress[] = loadWatchlist()): WatchedAddress[] {
  const next = existing.filter((e) => !isDemoWatchAddress(e.address))
  saveWatchlist(next)
  localStorage.removeItem(SAMPLE_SEED_KEY)
  return next
}

export function loadCachedSnapshotsBoth(): {
  snapshots: AddressSnapshot[]
  savedAt: string | null
} {
  const snaps: AddressSnapshot[] = []
  let oldest: string | null = null
  for (const chain of BOTH_CHAINS) {
    const { snapshots, savedAt } = loadCachedSnapshots(chain)
    snaps.push(...snapshots)
    // Staleness must follow the older chain so one fresh side can't hide a stale one.
    if (savedAt && (!oldest || savedAt < oldest)) oldest = savedAt
  }
  return { snapshots: snaps, savedAt: oldest }
}

export function pruneCachedSnapshotsBoth(watchlist: WatchedAddress[]) {
  const snaps: AddressSnapshot[] = []
  let oldest: string | null = null
  for (const chain of BOTH_CHAINS) {
    const pruned = pruneCachedSnapshots(chain, watchlist)
    snaps.push(...pruned.snapshots)
    if (pruned.savedAt && (!oldest || pruned.savedAt < oldest)) oldest = pruned.savedAt
  }
  return { snapshots: snaps, savedAt: oldest }
}

export function missingWatchlistSnapshotsBoth(
  watchlist: WatchedAddress[],
  snapshots: AddressSnapshot[],
): WatchedAddress[] {
  return watchlist.filter((w) => {
    const addr = w.address.toLowerCase()
    const haveEth = snapshots.some((s) => s.chain === 'ethereum' && s.address.toLowerCase() === addr)
    const havePls = snapshots.some((s) => s.chain === 'pulsechain' && s.address.toLowerCase() === addr)
    return !haveEth || !havePls
  })
}

export function saveWatchlist(entries: WatchedAddress[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(entries))
}

function readSnapshotCache(): SnapshotCacheFile {
  try {
    const raw = localStorage.getItem(SNAPSHOT_CACHE_KEY)
    if (!raw) return { version: 1, byChain: {} }
    const parsed = JSON.parse(raw) as SnapshotCacheFile
    if (!parsed || parsed.version !== 1 || typeof parsed.byChain !== 'object') {
      return { version: 1, byChain: {} }
    }
    return parsed
  } catch {
    return { version: 1, byChain: {} }
  }
}

export function loadCachedSnapshots(chain: ChainKey): {
  snapshots: AddressSnapshot[]
  savedAt: string | null
} {
  const entry = readSnapshotCache().byChain[chain]
  if (!entry?.snapshots?.length) return { snapshots: [], savedAt: null }
  return {
    snapshots: entry.snapshots
      .filter((s) => isAddress(s.address))
      .map((s) => ({
        ...s,
        stakes: (s.stakes ?? []).map((st) => normalizeStakeRow(st)),
      })),
    savedAt: entry.savedAt ?? null,
  }
}

function normalizeStakeRow(st: StakeRow): StakeRow {
  return {
    ...st,
    hdrnClaimable: st.hdrnClaimable ?? '0',
    hdrnClaimableUsd: st.hdrnClaimableUsd ?? '—',
    hdrnMintedDays: st.hdrnMintedDays ?? 0,
    hdrnLaunchBonus: st.hdrnLaunchBonus ?? 0,
    hdrnLoaned: st.hdrnLoaned ?? false,
    comClaimable: st.comClaimable ?? '0',
    comClaimableUsd: st.comClaimableUsd ?? '—',
    comClaimKind: st.comClaimKind ?? null,
    currentPls: st.currentPls ?? '—',
    gasEthUsd: st.gasEthUsd ?? '—',
    gasPlsUsd: st.gasPlsUsd ?? '—',
    gasPremium: st.gasPremium ?? '',
  }
}

export function saveCachedSnapshots(
  chain: ChainKey,
  snapshots: AddressSnapshot[],
  savedAt: string = new Date().toISOString(),
) {
  const file = readSnapshotCache()
  file.byChain[chain] = {
    savedAt,
    snapshots,
  }
  localStorage.setItem(SNAPSHOT_CACHE_KEY, JSON.stringify(file))
}

export function pruneCachedSnapshots(chain: ChainKey, watchlist: WatchedAddress[]) {
  const { snapshots, savedAt } = loadCachedSnapshots(chain)
  if (!snapshots.length) return { snapshots: [], savedAt }
  const keep = new Set(watchlist.map((w) => w.address.toLowerCase()))
  const next = snapshots.filter((s) => keep.has(s.address.toLowerCase()))
  if (next.length !== snapshots.length) {
    if (next.length === 0) {
      const file = readSnapshotCache()
      delete file.byChain[chain]
      localStorage.setItem(SNAPSHOT_CACHE_KEY, JSON.stringify(file))
      return { snapshots: [], savedAt: null }
    }
    // Keep original savedAt — pruning is not a chain refresh.
    saveCachedSnapshots(chain, next, savedAt ?? new Date().toISOString())
  }
  return { snapshots: next, savedAt }
}

export function cacheIsStale(savedAt: string | null, staleMs = CACHE_STALE_MS): boolean {
  if (!savedAt) return true
  const t = Date.parse(savedAt)
  if (!Number.isFinite(t)) return true
  return Date.now() - t >= staleMs
}

export function missingWatchlistSnapshots(
  watchlist: WatchedAddress[],
  snapshots: AddressSnapshot[],
): WatchedAddress[] {
  const have = new Set(snapshots.map((s) => s.address.toLowerCase()))
  return watchlist.filter((w) => !have.has(w.address.toLowerCase()))
}

export function normalizeAddress(input: string): Address {
  const trimmed = input.trim()
  if (!isAddress(trimmed)) throw new Error('Enter a valid 0x address.')
  return getAddress(trimmed)
}

function viemChain(chain: ChainKey) {
  return chain === 'ethereum' ? mainnet : pulsechain
}

async function clientFor(chain: ChainKey) {
  const config = CHAINS[chain]
  let lastError: unknown
  for (const url of config.rpcUrls) {
    try {
      const client = createPublicClient({
        chain: viemChain(chain),
        transport: http(url, { timeout: 18_000, retryCount: 0 }),
      })
      const id = await client.getChainId()
      if (id !== config.chainId) throw new Error(`Wrong chain id from ${url}`)
      return { client, url }
    } catch (error) {
      lastError = error
    }
  }
  throw lastError instanceof Error ? lastError : new Error(`No working RPC for ${config.label}`)
}

function money(n: number | null, digits = 2): string {
  if (n == null || !Number.isFinite(n)) return '—'
  return n.toLocaleString(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: digits })
}

function fmtHex(hearts: bigint): string {
  return formatUnits(hearts, 8)
}

async function accruedPayout(
  client: PublicClient,
  shares: bigint,
  lockedDay: bigint,
  stakedDays: bigint,
  currentDay: bigint,
): Promise<bigint> {
  const endDay = lockedDay + stakedDays
  const rangeEnd = currentDay < endDay ? currentDay : endDay
  if (rangeEnd <= lockedDay) return 0n
  let total = 0n
  for (let start = lockedDay; start < rangeEnd; start += DAILY_BATCH) {
    const stop = start + DAILY_BATCH > rangeEnd ? rangeEnd : start + DAILY_BATCH
    const packed = await client.readContract({
      address: HEX_ADDRESS,
      abi: HEX_READ_ABI,
      functionName: 'dailyDataRange',
      args: [start, stop],
    })
    for (const day of packed) total += decodeDailyPayout(day, shares)
  }
  return total
}

/** Detokenized + tokenized HSIs owned by this wallet (Hedron HSIM). */
async function loadHsiAddresses(client: PublicClient, owner: Address): Promise<Address[]> {
  const found = new Set<string>()
  try {
    const count = await client.readContract({
      address: HSIM_ADDRESS,
      abi: HSIM_ABI,
      functionName: 'hsiCount',
      args: [owner],
    })
    for (let i = 0; i < Number(count); i += 1) {
      const hsi = await client.readContract({
        address: HSIM_ADDRESS,
        abi: HSIM_ABI,
        functionName: 'hsiLists',
        args: [owner, BigInt(i)],
      })
      found.add(getAddress(hsi))
    }
  } catch {
    /* HSIM unavailable on this RPC */
  }
  try {
    const nftBal = await client.readContract({
      address: HSIM_ADDRESS,
      abi: HSIM_ABI,
      functionName: 'balanceOf',
      args: [owner],
    })
    for (let i = 0; i < Number(nftBal); i += 1) {
      const tokenId = await client.readContract({
        address: HSIM_ADDRESS,
        abi: HSIM_ABI,
        functionName: 'tokenOfOwnerByIndex',
        args: [owner, BigInt(i)],
      })
      const hsi = await client.readContract({
        address: HSIM_ADDRESS,
        abi: HSIM_ABI,
        functionName: 'hsiToken',
        args: [tokenId],
      })
      found.add(getAddress(hsi))
    }
  } catch {
    /* tokenized enumeration optional */
  }
  return [...found] as Address[]
}

async function readHexStakeAt(
  client: PublicClient,
  staker: Address,
  index: number,
): Promise<{
  stakeId: number
  stakedHearts: bigint
  stakeShares: bigint
  lockedDay: bigint
  stakedDays: bigint
  unlockedDay: bigint
  isAutoStake: boolean
  index: number
} | null> {
  try {
    const row = await client.readContract({
      address: HEX_ADDRESS,
      abi: HEX_READ_ABI,
      functionName: 'stakeLists',
      args: [staker, BigInt(index)],
    })
    const [stakeIdRaw, stakedHearts, stakeShares, lockedDayRaw, stakedDaysRaw, unlockedDayRaw, isAutoStake] =
      row
    return {
      stakeId: Number(stakeIdRaw),
      stakedHearts,
      stakeShares,
      lockedDay: BigInt(lockedDayRaw),
      stakedDays: BigInt(stakedDaysRaw),
      unlockedDay: BigInt(unlockedDayRaw),
      isAutoStake,
      index,
    }
  } catch {
    return null
  }
}

/** Hedron mintable HDRN ≈ shares × (served − minted), plus recorded LPB / AMR bonuses. */
function calcHdrnPayout(
  stakeShares: bigint,
  mintDays: number,
  launchBonus: number,
  dayMintMultiplier: number,
): bigint {
  if (mintDays <= 0 || stakeShares === 0n) return 0n
  let payout = stakeShares * BigInt(mintDays)
  if (launchBonus > 0) {
    payout += (payout * BigInt(launchBonus)) / 10n
  }
  if (dayMintMultiplier > 0) {
    payout += (payout * BigInt(dayMintMultiplier)) / 10n
  }
  return payout
}

async function loadHdrnShareState(
  client: PublicClient,
  stakeId: number,
  hsi: Address | null,
): Promise<{ mintedDays: number; launchBonus: number; isLoaned: boolean }> {
  if (hsi) {
    try {
      const share = await client.readContract({
        address: hsi,
        abi: HSI_ABI,
        functionName: 'share',
      })
      return {
        mintedDays: Number(share[1]),
        launchBonus: Number(share[2]),
        isLoaned: Boolean(share[7]),
      }
    } catch {
      /* fall through to Hedron shareList */
    }
  }
  try {
    const row = await client.readContract({
      address: HDRN_ADDRESS,
      abi: HDRN_READ_ABI,
      functionName: 'shareList',
      args: [BigInt(stakeId)],
    })
    if (Number(row[0].stakeId) === stakeId) {
      return {
        mintedDays: Number(row[1]),
        launchBonus: Number(row[2]),
        isLoaned: Boolean(row[7]),
      }
    }
  } catch {
    /* Hedron unavailable */
  }
  return { mintedDays: 0, launchBonus: 0, isLoaned: false }
}

async function loadDayMintMultiplier(client: PublicClient): Promise<number> {
  try {
    const hdrnDay = await client.readContract({
      address: HDRN_ADDRESS,
      abi: HDRN_READ_ABI,
      functionName: 'currentDay',
    })
    const daily = await client.readContract({
      address: HDRN_ADDRESS,
      abi: HDRN_READ_ABI,
      functionName: 'dailyDataList',
      args: [hdrnDay],
    })
    return Number(daily[4])
  } catch {
    return 0
  }
}

function fmtHdrn(raw: bigint): string {
  return formatUnits(raw, 9)
}

function fmtCom(raw: bigint): string {
  return formatUnits(raw, COM_DECIMALS)
}

async function loadHexShareRate(client: PublicClient): Promise<bigint> {
  try {
    const g = await client.readContract({
      address: HEX_ADDRESS,
      abi: HEX_READ_ABI,
      functionName: 'globals',
    })
    return BigInt(g[2])
  } catch {
    return 0n
  }
}

/** Communis start/end bonus still mintable for a native HEX stake (not HSI). */
async function loadComClaimable(
  client: PublicClient,
  currentDay: bigint,
  globalShareRate: bigint,
  raw: {
    stakeId: number
    stakedHearts: bigint
    stakeShares: bigint
    lockedDay: bigint
    stakedDays: bigint
    unlockedDay: bigint
  },
  hsi: Address | null,
): Promise<{ amount: bigint; kind: 'start' | 'end' | null }> {
  if (hsi || globalShareRate === 0n) return { amount: 0n, kind: null }
  const stakedDays = Number(raw.stakedDays)
  const shares = raw.stakeShares
  if (stakedDays <= 179 || shares <= 9999n) return { amount: 0n, kind: null }

  try {
    const [startMinted, endMinted] = await Promise.all([
      client.readContract({
        address: COM_ADDRESS,
        abi: COM_READ_ABI,
        functionName: 'stakeIdStartBonusPayout',
        args: [BigInt(raw.stakeId)],
      }),
      client.readContract({
        address: COM_ADDRESS,
        abi: COM_READ_ABI,
        functionName: 'stakeIdEndBonusPayout',
        args: [BigInt(raw.stakeId)],
      }),
    ])

    const day = Number(currentDay)
    const locked = Number(raw.lockedDay)
    const due = locked + stakedDays
    const eligibleStart =
      startMinted === 0n && endMinted === 0n && day >= locked
    const eligibleEnd =
      endMinted === 0n && stakedDays > 364 && day >= due && day <= due + 37

    if (!eligibleStart && !eligibleEnd) return { amount: 0n, kind: null }

    const pr = await client.readContract({
      address: COM_ADDRESS,
      abi: COM_READ_ABI,
      functionName: 'getPayout',
      args: [
        {
          stakeID: BigInt(raw.stakeId),
          stakedHearts: raw.stakedHearts,
          stakeShares: raw.stakeShares,
          lockedDay: raw.lockedDay,
          stakedDays: raw.stakedDays,
          unlockedDay: raw.unlockedDay,
        },
      ],
    })

    if (eligibleStart) {
      const payout = await client.readContract({
        address: COM_ADDRESS,
        abi: COM_READ_ABI,
        functionName: 'getStartBonusPayout',
        args: [
          raw.stakedDays,
          raw.lockedDay,
          pr.maxPayout,
          pr.stakesOriginalShareRate,
          currentDay,
          globalShareRate,
          false,
        ],
      })
      return { amount: payout > 0n ? payout : 0n, kind: payout > 0n ? 'start' : null }
    }

    const endPayout = pr.maxPayout > startMinted ? pr.maxPayout - startMinted : 0n
    return { amount: endPayout, kind: endPayout > 0n ? 'end' : null }
  } catch {
    return { amount: 0n, kind: null }
  }
}

async function enrichStakeRow(
  client: PublicClient,
  day: bigint,
  quotes: QuoteSet,
  chain: ChainKey,
  gasOwner: Address,
  raw: {
    stakeId: number
    stakedHearts: bigint
    stakeShares: bigint
    lockedDay: bigint
    stakedDays: bigint
    unlockedDay: bigint
    isAutoStake: boolean
    index: number
  },
  hsi: Address | null,
  gasBoard: GasBoard | null,
  amrMultiplier = 0,
  globalShareRate = 0n,
): Promise<StakeRow> {
  const { lockedDay: locked, stakedDays: days, unlockedDay: unlocked, stakedHearts, stakeShares } = raw
  const status = deriveStatus(day, locked, days, unlocked)
  const endDay = locked + days
  const served = servedDays(day, locked, days)
  const progressPct = days === 0n ? 0 : Math.min(100, Math.round((Number(served) / Number(days)) * 100))
  const payout = await accruedPayout(client, stakeShares, locked, days, day)
  const currentHearts = stakedHearts + payout
  const pen = penaltyCopy(status, day, locked, days, payout, stakedHearts)
  const apy = annualizedPct(stakedHearts, payout, served)
  const hexUsd = quotes.hexUsd
  const hexEth = quotes.hexEth
  const hexPls =
    quotes.hexPls ??
    (quotes.hexUsd != null && quotes.plsUsd != null && quotes.plsUsd > 0
      ? quotes.hexUsd / quotes.plsUsd
      : null)
  const startHex = Number(formatUnits(stakedHearts, 8))
  const nowHex = Number(formatUnits(currentHearts, 8))
  const compare = formatGasCompare(gasBoard)
  const gas = hsi
    ? {
        gasNative: '—',
        gasUsd: '—',
        gasNote: 'HSI · end through Hedron HSIM',
      }
    : await estimateEndGas(client, gasOwner, raw.index, raw.stakeId, quotes, chain, gasBoard)

  const shareState = await loadHdrnShareState(client, raw.stakeId, hsi)
  const mintDays = Math.max(0, Number(served) - shareState.mintedDays)
  const amr = shareState.isLoaned ? 0 : amrMultiplier
  const hdrnRaw = shareState.isLoaned
    ? 0n
    : calcHdrnPayout(stakeShares, mintDays, shareState.launchBonus, amr)
  const hdrnNum = Number(formatUnits(hdrnRaw, 9))

  const com = await loadComClaimable(client, day, globalShareRate, raw, hsi)
  const comNum = Number(formatUnits(com.amount, COM_DECIMALS))

  return {
    index: raw.index,
    stakeId: raw.stakeId,
    stakedHearts: stakedHearts.toString(),
    stakedHex: fmtHex(stakedHearts),
    shares: stakeShares.toString(),
    lockedDay: Number(locked),
    stakedDays: Number(days),
    unlockedDay: Number(unlocked),
    isAutoStake: raw.isAutoStake,
    status,
    progressPct,
    startDate: formatDayDate(Number(locked)),
    endDate: formatDayDate(Number(endDay)),
    graceEndDate: formatDayDate(Number(endDay + 14n)),
    payoutHex: fmtHex(payout),
    currentHex: fmtHex(currentHearts),
    startUsd: money(hexUsd != null ? startHex * hexUsd : null),
    currentUsd: money(hexUsd != null ? nowHex * hexUsd : null),
    startEth:
      hexEth != null
        ? `${(startHex * hexEth).toLocaleString(undefined, { maximumFractionDigits: 6 })} ETH`
        : '—',
    currentEth:
      chain === 'ethereum' && hexEth != null
        ? `${(nowHex * hexEth).toLocaleString(undefined, { maximumFractionDigits: 6 })} ETH`
        : '—',
    currentPls:
      chain === 'pulsechain' && hexPls != null
        ? `${(nowHex * hexPls).toLocaleString(undefined, { maximumFractionDigits: 0 })} PLS`
        : '—',
    apy: apy == null ? '—' : `${apy.toFixed(1)}%`,
    penaltyHex: fmtHex(pen.penalty),
    ifEndedHex: fmtHex(pen.ifEnded),
    hsi,
    hdrnClaimable: shareState.isLoaned ? '0' : fmtHdrn(hdrnRaw),
    hdrnClaimableUsd: money(
      !shareState.isLoaned && quotes.hdrnUsd != null && Number.isFinite(hdrnNum)
        ? hdrnNum * quotes.hdrnUsd
        : null,
    ),
    hdrnMintedDays: shareState.mintedDays,
    hdrnLaunchBonus: shareState.launchBonus,
    hdrnLoaned: shareState.isLoaned,
    comClaimable: fmtCom(com.amount),
    comClaimableUsd: money(
      com.amount > 0n && quotes.comUsd != null && Number.isFinite(comNum)
        ? comNum * quotes.comUsd
        : null,
    ),
    comClaimKind: com.kind,
    gasNative: gas.gasNative,
    gasUsd: gas.gasUsd,
    gasNote: gas.gasNote,
    gasEthUsd: compare.ethUsd,
    gasPlsUsd: compare.plsUsd,
    gasPremium: compare.premiumLabel,
  }
}

async function estimateEndGas(
  client: PublicClient,
  owner: Address,
  index: number,
  stakeId: number,
  quotes: QuoteSet,
  chain: ChainKey,
  gasBoard: GasBoard | null,
): Promise<{ gasNative: string; gasUsd: string; gasNote: string }> {
  const data = encodeFunctionData({
    abi: HEX_READ_ABI,
    functionName: 'stakeEnd',
    args: [BigInt(index), stakeId],
  })
  let gas = 140_000n
  try {
    gas = await client.estimateGas({
      account: owner,
      to: HEX_ADDRESS,
      data,
    })
  } catch {
    /* typical stakeEnd weight */
  }

  let gasPrice: bigint | null = null
  try {
    gasPrice = await client.getGasPrice()
  } catch {
    const gwei = chain === 'ethereum' ? gasBoard?.ethGwei : gasBoard?.plsGwei
    if (gwei != null && Number.isFinite(gwei) && gwei > 0) {
      gasPrice = BigInt(Math.round(gwei * 1e9))
    }
  }
  if (gasPrice == null) {
    return {
      gasNative: '—',
      gasUsd: '—',
      gasNote: 'gas price unavailable · try refresh',
    }
  }

  const wei = gas * gasPrice
  const native = Number(formatEther(wei))
  if (chain === 'ethereum') {
    return {
      gasNative: `${native.toLocaleString(undefined, { maximumFractionDigits: 5 })} ETH`,
      gasUsd: money(quotes.ethUsd != null ? native * quotes.ethUsd : null),
      gasNote: `est. ${gas.toString()} gas · if you end today`,
    }
  }
  return {
    gasNative: `${native.toLocaleString(undefined, { maximumFractionDigits: 2 })} PLS`,
    gasUsd: money(quotes.plsUsd != null ? native * quotes.plsUsd : null),
    gasNote: `est. ${gas.toString()} gas · if you end today`,
  }
}

function penaltyCopy(
  status: StakeStatus,
  currentDay: bigint,
  lockedDay: bigint,
  stakedDays: bigint,
  payout: bigint,
  principal: bigint,
): { penalty: bigint; ifEnded: bigint } {
  const served = servedDays(currentDay, lockedDay, stakedDays)
  const raw = principal + payout
  if (status === 'active' || status === 'scheduled') {
    const penalty = estimateEarlyPenalty(principal, payout, stakedDays, served)
    const capped = penalty > raw ? raw : penalty
    return {
      penalty: capped,
      ifEnded: raw - capped,
    }
  }
  if (status === 'mature') {
    return {
      penalty: 0n,
      ifEnded: raw,
    }
  }
  if (status === 'late') {
    const penalty = estimateLatePenalty(raw, currentDay, lockedDay, stakedDays)
    return {
      penalty,
      ifEnded: raw - penalty,
    }
  }
  return { penalty: 0n, ifEnded: raw }
}

export async function loadCurrentDay(chain: ChainKey): Promise<{ day: number; rpcUsed: string }> {
  const { client, url } = await clientFor(chain)
  const currentDay = await client.readContract({
    address: HEX_ADDRESS,
    abi: HEX_READ_ABI,
    functionName: 'currentDay',
  })
  return { day: Number(currentDay), rpcUsed: url }
}

export async function loadSnapshot(
  chain: ChainKey,
  address: Address,
  gasBoard: GasBoard | null = null,
  quotes?: QuoteSet,
): Promise<AddressSnapshot> {
  const { client, url } = await clientFor(chain)
  const q = quotes ?? (await loadQuotes(chain))

  const [currentDay, count, balance, hsiAddresses] = await Promise.all([
    client.readContract({
      address: HEX_ADDRESS,
      abi: HEX_READ_ABI,
      functionName: 'currentDay',
    }),
    client.readContract({
      address: HEX_ADDRESS,
      abi: HEX_READ_ABI,
      functionName: 'stakeCount',
      args: [address],
    }),
    client.readContract({
      address: HEX_ADDRESS,
      abi: HEX_READ_ABI,
      functionName: 'balanceOf',
      args: [address],
    }),
    loadHsiAddresses(client, address),
  ])

  const day = currentDay
  const stakes: StakeRow[] = []
  const seenStakeIds = new Set<number>()
  const [amrMultiplier, globalShareRate] = await Promise.all([
    loadDayMintMultiplier(client),
    loadHexShareRate(client),
  ])

  // Native HEX stakes still on this wallet.
  for (let index = 0; index < Number(count); index += 1) {
    const raw = await readHexStakeAt(client, address, index)
    if (!raw) continue
    seenStakeIds.add(raw.stakeId)
    stakes.push(
      await enrichStakeRow(
        client,
        day,
        q,
        chain,
        address,
        raw,
        null,
        gasBoard,
        amrMultiplier,
        globalShareRate,
      ),
    )
  }

  // HSI-wrapped stakes: HEX stakeLists live on the HSI contract, not the wallet.
  for (const hsi of hsiAddresses) {
    let hsiStakeCount = 0
    try {
      hsiStakeCount = Number(
        await client.readContract({
          address: HEX_ADDRESS,
          abi: HEX_READ_ABI,
          functionName: 'stakeCount',
          args: [hsi],
        }),
      )
    } catch {
      continue
    }
    for (let index = 0; index < hsiStakeCount; index += 1) {
      const raw = await readHexStakeAt(client, hsi, index)
      if (!raw || seenStakeIds.has(raw.stakeId)) continue
      seenStakeIds.add(raw.stakeId)
      stakes.push(
        await enrichStakeRow(
          client,
          day,
          q,
          chain,
          address,
          raw,
          hsi,
          gasBoard,
          amrMultiplier,
          globalShareRate,
        ),
      )
    }
  }

  return {
    chain,
    address,
    currentDay: Number(day),
    liquidHex: fmtHex(balance),
    stakes,
    hsiCount: hsiAddresses.length,
    observedAt: new Date().toISOString(),
    rpcUsed: url,
    quoteSource: q.source,
  }
}
