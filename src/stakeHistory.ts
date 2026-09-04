import {
  createPublicClient,
  formatUnits,
  http,
  type Address,
  type PublicClient,
} from 'viem'
import { mainnet } from 'viem/chains'
import {
  CHAINS,
  HEX_ADDRESS,
  HEX_EVENT_ABI,
  HEX_LOG_FROM_BLOCK,
  type ChainKey,
} from './hex'
import { estimateHexDay, formatDayDate } from './hexMath'
import type { StakeRow } from './data'
import { money } from './quotes'

const TIMESTAMP_BITS = 40n
const HEARTS_BITS = 72n
const DAY_BITS = 16n
const TIMESTAMP_MASK = (1n << TIMESTAMP_BITS) - 1n
const HEARTS_MASK = (1n << HEARTS_BITS) - 1n
const DAY_MASK = (1n << DAY_BITS) - 1n

/** Start chunk; shrinks on RPC range errors (some free RPCs cap at ~50–2k). */
const LOG_CHUNK_START: Record<ChainKey, bigint> = {
  ethereum: 2_000n,
  pulsechain: 4_000n,
}
const LOG_CHUNK_MIN = 50n
/** v3 = StakeEnd-only, newest-first, no empty-fail cache. */
const CACHE_PREFIX = 'hex-watch/stake-history/v3/'

const pulsechain = {
  id: 369,
  name: 'PulseChain',
  nativeCurrency: { name: 'Pulse', symbol: 'PLS', decimals: 18 },
  rpcUrls: { default: { http: ['https://rpc.pulsechain.com'] } },
} as const

export interface HistoryProgress {
  chain: ChainKey
  address: Address
  fromBlock: bigint
  toBlock: bigint
  head: bigint
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

async function clientsFor(chain: ChainKey): Promise<PublicClient[]> {
  const config = CHAINS[chain]
  const viemChain = chain === 'ethereum' ? mainnet : pulsechain
  const out: PublicClient[] = []
  for (const url of config.rpcUrls) {
    try {
      const client = createPublicClient({
        chain: viemChain,
        transport: http(url, { timeout: 20_000, retryCount: 0 }),
      })
      const id = await client.getChainId()
      if (id !== config.chainId) continue
      out.push(client as PublicClient)
    } catch {
      /* next */
    }
  }
  return out
}

type HexStakeLog = {
  args: {
    data0?: bigint
    data1?: bigint
    stakeId?: number | bigint
  }
}

function isRangeError(error: unknown): boolean {
  const msg = error instanceof Error ? error.message : String(error)
  return /block|range|limited|exceed|10,?000|query returned more|response size/i.test(msg)
}

async function fetchStakeEndChunk(
  clients: PublicClient[],
  stakerAddr: Address,
  fromBlock: bigint,
  toBlock: bigint,
): Promise<{ logs: HexStakeLog[]; error?: string }> {
  let lastErr = ''
  for (const client of clients) {
    try {
      const batch = (await client.getContractEvents({
        address: HEX_ADDRESS,
        abi: HEX_EVENT_ABI,
        eventName: 'StakeEnd',
        args: { stakerAddr },
        fromBlock,
        toBlock,
        strict: true,
      })) as HexStakeLog[]
      return { logs: batch }
    } catch (error) {
      lastErr = error instanceof Error ? error.message.split('\n')[0] : String(error)
      if (!isRangeError(error)) continue
      // try next client with same range; caller may shrink
    }
  }
  return { logs: [], error: lastErr || 'getLogs failed' }
}

/**
 * Newest → oldest StakeEnd scan so recent ends appear first.
 * Shrinks chunk size when RPCs reject the range.
 */
async function getLogsNewestFirst(
  clients: PublicClient[],
  chain: ChainKey,
  stakerAddr: Address,
  fromBlock: bigint,
  toBlock: bigint,
  onChunk?: (from: bigint, to: bigint, found: number) => void,
  onLogs?: (logs: HexStakeLog[]) => void,
): Promise<{ logs: HexStakeLog[]; partial: boolean; errors: string[] }> {
  const logs: HexStakeLog[] = []
  const errors: string[] = []
  let partial = false
  let chunk = LOG_CHUNK_START[chain]
  let cursor = toBlock

  while (cursor >= fromBlock) {
    let start = cursor - chunk + 1n
    if (start < fromBlock) start = fromBlock
    onChunk?.(start, cursor, logs.length)

    let result = await fetchStakeEndChunk(clients, stakerAddr, start, cursor)
    while (result.error && isRangeError(result.error) && chunk > LOG_CHUNK_MIN) {
      chunk = chunk > 500n ? chunk / 2n : LOG_CHUNK_MIN
      start = cursor - chunk + 1n
      if (start < fromBlock) start = fromBlock
      onChunk?.(start, cursor, logs.length)
      result = await fetchStakeEndChunk(clients, stakerAddr, start, cursor)
    }

    if (result.error) {
      partial = true
      if (errors.length < 4) {
        errors.push(`StakeEnd ${start}-${cursor}: ${result.error}`)
      }
    } else if (result.logs.length) {
      logs.push(...result.logs)
      onLogs?.(result.logs)
    }

    if (start === fromBlock) break
    cursor = start - 1n
  }

  return { logs, partial, errors }
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
    ...blankEnrichment('Historical · from StakeEnd log'),
  }
}

function logsToRows(logs: HexStakeLog[], hexUsd: number | null, seen: Set<number>): StakeRow[] {
  const stakes: StakeRow[] = []
  for (const log of logs) {
    const args = log.args
    if (args.data0 == null || args.data1 == null || args.stakeId == null) continue
    const end = decodeStakeEnd(args.data0, args.data1, BigInt(args.stakeId))
    if (seen.has(end.stakeId)) continue
    seen.add(end.stakeId)
    stakes.push(toStakeRow(end, hexUsd))
  }
  return stakes
}

/** Scan StakeEnd logs only for one address on one chain (newest first). */
export async function loadEndedHistory(
  chain: ChainKey,
  address: Address,
  hexUsd: number | null,
  onProgress?: (p: HistoryProgress) => void,
  onPartial?: (stakes: StakeRow[]) => void,
): Promise<HistoryLoadResult> {
  const clients = await clientsFor(chain)
  if (clients.length === 0) {
    return {
      stakes: [],
      partial: true,
      errors: [`No working RPC for ${CHAINS[chain].label}`],
      savedAt: new Date().toISOString(),
    }
  }

  const head = await clients[0].getBlockNumber()
  const fromBlock = HEX_LOG_FROM_BLOCK[chain]
  const label = CHAINS[chain].label
  const seen = new Set<number>()
  const stakes: StakeRow[] = []

  const ends = await getLogsNewestFirst(
    clients,
    chain,
    address,
    fromBlock,
    head,
    (from, to, found) =>
      onProgress?.({
        chain,
        address,
        fromBlock: from,
        toBlock: to,
        head,
        found,
        label: `${label} StakeEnd · ${found} found · blocks ${from.toString()}–${to.toString()}`,
      }),
    (batch) => {
      const rows = logsToRows(batch, hexUsd, seen)
      if (!rows.length) return
      stakes.push(...rows)
      stakes.sort((a, b) => b.unlockedDay - a.unlockedDay || b.stakeId - a.stakeId)
      onPartial?.(stakes.slice())
    },
  )

  // Dedup if onLogs path missed (errors-only path still has ends.logs)
  if (stakes.length === 0 && ends.logs.length) {
    stakes.push(...logsToRows(ends.logs, hexUsd, seen))
    stakes.sort((a, b) => b.unlockedDay - a.unlockedDay || b.stakeId - a.stakeId)
  }

  // Never cache a total miss caused by RPC failure — that blocks retries.
  let savedAt = new Date().toISOString()
  if (!(ends.partial && stakes.length === 0)) {
    savedAt = saveHistoryCache(chain, address, stakes, ends.partial)
  }

  return { stakes, partial: ends.partial, errors: ends.errors.slice(0, 4), savedAt }
}

/** Load history for many addresses across both chains (cache-first unless force). */
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
      errors.push(...result.errors.map((e) => `${CHAINS[chain].label} ${address.slice(0, 6)}…: ${e}`))
    }
  }

  return { byKey, partial, errors: errors.slice(0, 4) }
}
