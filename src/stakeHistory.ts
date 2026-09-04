import { formatUnits, type Address } from 'viem'
import { CHAINS, HEX_ADDRESS, type ChainKey } from './hex'
import { estimateHexDay, formatDayDate } from './hexMath'
import type { StakeRow } from './data'
import { money } from './quotes'

const TIMESTAMP_BITS = 40n
const HEARTS_BITS = 72n
const DAY_BITS = 16n
const TIMESTAMP_MASK = (1n << TIMESTAMP_BITS) - 1n
const HEARTS_MASK = (1n << HEARTS_BITS) - 1n
const DAY_MASK = (1n << DAY_BITS) - 1n

/** StakeEnd(uint256,uint256,address,uint40) */
const STAKE_END_TOPIC0 =
  '0x72d9c5a7ab13846e08d9c838f9e866a1bb4a66a2fd3ba3c9e7da3cf9e394dfd7' as const

/** Indexed explorer APIs — one (or few) HTTP calls, not a full-chain RPC crawl. */
const EXPLORER_LOG_APIS: Record<ChainKey, string[]> = {
  ethereum: [
    'https://eth.blockscout.com/api',
    'https://api.routescan.io/v2/network/mainnet/evm/1/etherscan/api',
  ],
  pulsechain: ['https://api.scan.pulsechain.com/api'],
}

const CACHE_PREFIX = 'hex-watch/stake-history/v5/'
const PAGE_SIZE = 1000

export interface HistoryProgress {
  chain: ChainKey
  address: Address
  label: string
  found?: number
}

export interface HistoryLoadResult {
  stakes: StakeRow[]
  partial: boolean
  errors: string[]
  savedAt: string
}

interface CacheFile {
  version: 1
  chain: ChainKey
  address: string
  savedAt: string
  stakes: StakeRow[]
  partial?: boolean
}

interface DecodedEnd {
  stakeId: number
  timestamp: number
  stakedHearts: bigint
  stakeShares: bigint
  payout: bigint
  penalty: bigint
  servedDays: number
}

interface ExplorerLog {
  data?: string
  topics?: string[]
  timeStamp?: string
  blockNumber?: string
}

function cacheKey(chain: ChainKey, address: Address): string {
  return `${CACHE_PREFIX}${chain}:${address.toLowerCase()}`
}

export function loadHistoryCache(chain: ChainKey, address: Address): HistoryLoadResult | null {
  try {
    const raw = localStorage.getItem(cacheKey(chain, address))
    if (!raw) return null
    const parsed = JSON.parse(raw) as CacheFile
    if (!parsed || parsed.version !== 1 || !Array.isArray(parsed.stakes)) return null
    return {
      stakes: parsed.stakes,
      partial: Boolean(parsed.partial),
      errors: [],
      savedAt: parsed.savedAt,
    }
  } catch {
    return null
  }
}

function saveHistoryCache(
  chain: ChainKey,
  address: Address,
  stakes: StakeRow[],
  partial: boolean,
): string {
  const savedAt = new Date().toISOString()
  const file: CacheFile = {
    version: 1,
    chain,
    address: address.toLowerCase(),
    savedAt,
    stakes,
    partial,
  }
  localStorage.setItem(cacheKey(chain, address), JSON.stringify(file))
  return savedAt
}

export function clearHistoryCache(chain: ChainKey, address: Address) {
  localStorage.removeItem(cacheKey(chain, address))
}

function topicAddress(address: Address): string {
  return `0x${address.slice(2).toLowerCase().padStart(64, '0')}`
}

function parseBlockNumber(raw: string | undefined): number | null {
  if (!raw) return null
  const n = raw.startsWith('0x') ? Number.parseInt(raw, 16) : Number.parseInt(raw, 10)
  return Number.isFinite(n) ? n : null
}

function decodeStakeEnd(data0: bigint, data1: bigint, stakeId: bigint): DecodedEnd {
  let d = data0
  const timestamp = Number(d & TIMESTAMP_MASK)
  d >>= TIMESTAMP_BITS
  const stakedHearts = d & HEARTS_MASK
  d >>= HEARTS_BITS
  const stakeShares = d & HEARTS_MASK
  d >>= HEARTS_BITS
  const payout = d & HEARTS_MASK

  d = data1
  const penalty = d & HEARTS_MASK
  d >>= HEARTS_BITS
  const servedDays = Number(d & DAY_MASK)

  return {
    stakeId: Number(stakeId),
    timestamp,
    stakedHearts,
    stakeShares,
    payout,
    penalty,
    servedDays,
  }
}

function fmtHex(hearts: bigint): string {
  return formatUnits(hearts, 8)
}

function blankEnrichment(note: string): Pick<
  StakeRow,
  | 'hdrnClaimable'
  | 'hdrnClaimableUsd'
  | 'hdrnMintedDays'
  | 'hdrnLaunchBonus'
  | 'hdrnLoaned'
  | 'comClaimable'
  | 'comClaimableUsd'
  | 'comClaimKind'
  | 'gasNative'
  | 'gasUsd'
  | 'gasNote'
  | 'gasEthUsd'
  | 'gasPlsUsd'
  | 'gasPremium'
  | 'startEth'
  | 'currentEth'
  | 'currentPls'
  | 'apy'
> {
  return {
    hdrnClaimable: '0',
    hdrnClaimableUsd: '—',
    hdrnMintedDays: 0,
    hdrnLaunchBonus: 0,
    hdrnLoaned: false,
    comClaimable: '0',
    comClaimableUsd: '—',
    comClaimKind: null,
    gasNative: '—',
    gasUsd: '—',
    gasNote: note,
    gasEthUsd: '—',
    gasPlsUsd: '—',
    gasPremium: '—',
    startEth: '—',
    currentEth: '—',
    currentPls: '—',
    apy: '—',
  }
}

function toStakeRow(end: DecodedEnd, hexUsd: number | null): StakeRow {
  const hearts = end.stakedHearts
  const shares = end.stakeShares
  const stakedDays = end.servedDays
  const unlockedDay = estimateHexDay(end.timestamp * 1000)
  const lockedDay = Math.max(0, unlockedDay - stakedDays)
  const endDay = lockedDay + stakedDays
  const principal = Number(formatUnits(hearts, 8))
  const payoutNum = Number(formatUnits(end.payout, 8))
  const penaltyNum = Number(formatUnits(end.penalty, 8))
  const returned = principal + payoutNum - penaltyNum
  const ifEndedHearts = hearts + end.payout - end.penalty

  return {
    index: -1,
    stakeId: end.stakeId,
    stakedHearts: hearts.toString(),
    stakedHex: fmtHex(hearts),
    shares: shares.toString(),
    lockedDay,
    stakedDays,
    unlockedDay,
    isAutoStake: false,
    status: 'ended',
    progressPct: 100,
    startDate: formatDayDate(lockedDay),
    endDate: formatDayDate(endDay),
    graceEndDate: formatDayDate(endDay + 14),
    payoutHex: fmtHex(end.payout),
    currentHex: fmtHex(ifEndedHearts > 0n ? ifEndedHearts : 0n),
    startUsd: money(hexUsd != null ? principal * hexUsd : null),
    currentUsd: money(hexUsd != null ? returned * hexUsd : null),
    penaltyHex: fmtHex(end.penalty),
    ifEndedHex: fmtHex(ifEndedHearts > 0n ? ifEndedHearts : 0n),
    hsi: null,
    historical: true,
    ...blankEnrichment('Historical · explorer StakeEnd'),
  }
}

function parseExplorerLog(log: ExplorerLog): DecodedEnd | null {
  const topics = log.topics
  const data = log.data
  if (!topics || topics.length < 3 || !data || data.length < 130) return null
  try {
    const stakeId = BigInt(topics[2])
    const hex = data.startsWith('0x') ? data.slice(2) : data
    if (hex.length < 128) return null
    const data0 = BigInt(`0x${hex.slice(0, 64)}`)
    const data1 = BigInt(`0x${hex.slice(64, 128)}`)
    return decodeStakeEnd(data0, data1, stakeId)
  } catch {
    return null
  }
}

async function fetchExplorerPage(
  apiBase: string,
  staker: Address,
  fromBlock: number,
): Promise<{ logs: ExplorerLog[]; error?: string }> {
  const params = new URLSearchParams({
    module: 'logs',
    action: 'getLogs',
    fromBlock: String(fromBlock),
    toBlock: 'latest',
    address: HEX_ADDRESS,
    topic0: STAKE_END_TOPIC0,
    topic1: topicAddress(staker),
    topic0_1_opr: 'and',
  })
  const url = `${apiBase}?${params.toString()}`
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(25_000) })
    if (!res.ok) return { logs: [], error: `HTTP ${res.status}` }
    const json = (await res.json()) as {
      status?: string
      message?: string
      result?: ExplorerLog[] | string
    }
    if (json.status === '0') {
      const msg = String(json.result ?? json.message ?? 'explorer error')
      if (/no records|no logs|result not found/i.test(msg)) return { logs: [] }
      return { logs: [], error: msg.slice(0, 120) }
    }
    if (!Array.isArray(json.result)) return { logs: [] }
    return { logs: json.result }
  } catch (error) {
    return {
      logs: [],
      error: error instanceof Error ? error.message.split('\n')[0] : String(error),
    }
  }
}

/** Pull all StakeEnd logs for one staker via explorer index (paginated at 1000). */
async function fetchStakeEndsFromExplorer(
  chain: ChainKey,
  staker: Address,
  onProgress?: (found: number, page: number) => void,
): Promise<{ logs: ExplorerLog[]; partial: boolean; errors: string[] }> {
  const apis = EXPLORER_LOG_APIS[chain]
  const errors: string[] = []
  let lastError = ''

  for (const apiBase of apis) {
    const all: ExplorerLog[] = []
    let fromBlock = 0
    let page = 0
    let partial = false
    let ok = false

    while (page < 20) {
      page += 1
      onProgress?.(all.length, page)
      const { logs, error } = await fetchExplorerPage(apiBase, staker, fromBlock)
      if (error) {
        lastError = error
        break
      }
      ok = true
      if (!logs.length) break
      all.push(...logs)
      if (logs.length < PAGE_SIZE) break
      // Advance past last block so we do not loop forever on the same page.
      const lastBn = parseBlockNumber(logs[logs.length - 1]?.blockNumber)
      if (lastBn == null || lastBn < fromBlock) {
        partial = true
        break
      }
      fromBlock = lastBn + 1
    }

    if (ok) {
      return { logs: all, partial, errors }
    }
  }

  if (lastError) errors.push(lastError)
  return { logs: [], partial: true, errors }
}

function logsToRows(logs: ExplorerLog[], hexUsd: number | null): StakeRow[] {
  const seen = new Set<number>()
  const stakes: StakeRow[] = []
  for (const log of logs) {
    const end = parseExplorerLog(log)
    if (!end || seen.has(end.stakeId)) continue
    seen.add(end.stakeId)
    stakes.push(toStakeRow(end, hexUsd))
  }
  stakes.sort((a, b) => b.unlockedDay - a.unlockedDay || b.stakeId - a.stakeId)
  return stakes
}

/** Load ended stakes for one address via explorer index (seconds, not a chain crawl). */
export async function loadEndedHistory(
  chain: ChainKey,
  address: Address,
  hexUsd: number | null,
  onProgress?: (p: HistoryProgress) => void,
  onPartial?: (stakes: StakeRow[]) => void,
): Promise<HistoryLoadResult> {
  const label = CHAINS[chain].label
  onProgress?.({
    chain,
    address,
    found: 0,
    label: `${label} · fetching StakeEnd index…`,
  })

  const { logs, partial, errors } = await fetchStakeEndsFromExplorer(
    chain,
    address,
    (found, page) =>
      onProgress?.({
        chain,
        address,
        found,
        label: `${label} · StakeEnd page ${page} · ${found} so far`,
      }),
  )

  const stakes = logsToRows(logs, hexUsd)
  onPartial?.(stakes)

  let savedAt = new Date().toISOString()
  if (!(partial && stakes.length === 0 && errors.length > 0)) {
    savedAt = saveHistoryCache(chain, address, stakes, partial)
  }

  return { stakes, partial, errors: errors.slice(0, 4), savedAt }
}

/** Load history for many addresses (cache-first unless force). */
export async function loadEndedHistoryForWatchlist(
  addresses: Address[],
  hexUsdByChain: Record<ChainKey, number | null>,
  opts: {
    force?: boolean
    chains?: ChainKey[]
    onProgress?: (p: HistoryProgress) => void
    onPartial?: (key: string, stakes: StakeRow[]) => void
  } = {},
): Promise<{
  byKey: Record<string, StakeRow[]>
  partial: boolean
  errors: string[]
}> {
  const chains = opts.chains ?? (['ethereum', 'pulsechain'] as ChainKey[])
  const byKey: Record<string, StakeRow[]> = {}
  const errors: string[] = []
  let partial = false

  for (const chain of chains) {
    for (const address of addresses) {
      const key = `${chain}:${address.toLowerCase()}`
      if (!opts.force) {
        const cached = loadHistoryCache(chain, address)
        if (cached) {
          byKey[key] = cached.stakes
          if (cached.partial) partial = true
          continue
        }
      }
      const result = await loadEndedHistory(
        chain,
        address,
        hexUsdByChain[chain],
        opts.onProgress,
        (stakes) => {
          byKey[key] = stakes
          opts.onPartial?.(key, stakes)
        },
      )
      byKey[key] = result.stakes
      if (result.partial) partial = true
      errors.push(
        ...result.errors.map((e) => `${CHAINS[chain].label} ${address.slice(0, 6)}…: ${e}`),
      )
    }
  }

  return { byKey, partial, errors: errors.slice(0, 4) }
}
