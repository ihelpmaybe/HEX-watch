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

/** Public RPCs often reject oversized eth_getLogs ranges. */
const LOG_CHUNK = 4_000n
/** v2 = StakeEnd-only scans (no StakeStart walk). */
const CACHE_PREFIX = 'hex-watch/stake-history/v2/'

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

async function clientFor(chain: ChainKey): Promise<PublicClient | null> {
  const config = CHAINS[chain]
  const viemChain = chain === 'ethereum' ? mainnet : pulsechain
  for (const url of config.rpcUrls) {
    try {
      const client = createPublicClient({
        chain: viemChain,
        transport: http(url, { timeout: 20_000, retryCount: 0 }),
      })
      const id = await client.getChainId()
      if (id !== config.chainId) continue
      return client as PublicClient
    } catch {
      /* next */
    }
  }
  return null
}

type HexStakeLog = {
  args: {
    data0?: bigint
    data1?: bigint
    stakeId?: number | bigint
  }
}

async function getLogsChunked(
  client: PublicClient,
  stakerAddr: Address,
  fromBlock: bigint,
  toBlock: bigint,
  onChunk?: (from: bigint, to: bigint) => void,
): Promise<{ logs: HexStakeLog[]; partial: boolean; errors: string[] }> {
  const eventName = 'StakeEnd' as const
  const logs: HexStakeLog[] = []
  const errors: string[] = []
  let partial = false
  let cursor = fromBlock

  while (cursor <= toBlock) {
    let end = cursor + LOG_CHUNK - 1n
    if (end > toBlock) end = toBlock
    onChunk?.(cursor, end)
    try {
      const batch = (await client.getContractEvents({
        address: HEX_ADDRESS,
        abi: HEX_EVENT_ABI,
        eventName,
        args: { stakerAddr },
        fromBlock: cursor,
        toBlock: end,
        strict: true,
      })) as HexStakeLog[]
      logs.push(...batch)
    } catch (error) {
      partial = true
      errors.push(
        `${eventName} ${cursor}-${end}: ${
          error instanceof Error ? error.message.split('\n')[0] : String(error)
        }`,
      )
      // Shrink once and retry this window; if still failing, skip ahead.
      const mid = cursor + (end - cursor) / 2n
      if (mid > cursor && mid < end) {
        try {
          const a = (await client.getContractEvents({
            address: HEX_ADDRESS,
            abi: HEX_EVENT_ABI,
            eventName,
            args: { stakerAddr },
            fromBlock: cursor,
            toBlock: mid,
            strict: true,
          })) as HexStakeLog[]
          const b = (await client.getContractEvents({
            address: HEX_ADDRESS,
            abi: HEX_EVENT_ABI,
            eventName,
            args: { stakerAddr },
            fromBlock: mid + 1n,
            toBlock: end,
            strict: true,
          })) as HexStakeLog[]
          logs.push(...a, ...b)
          partial = false
          errors.pop()
        } catch {
          /* keep skip */
        }
      }
    }
    cursor = end + 1n
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
  // StakeEnd carries servedDays, not original stakedDays — good enough for history cards.
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

/** Scan StakeEnd logs only for one address on one chain. */
export async function loadEndedHistory(
  chain: ChainKey,
  address: Address,
  hexUsd: number | null,
  onProgress?: (p: HistoryProgress) => void,
): Promise<HistoryLoadResult> {
  const client = await clientFor(chain)
  if (!client) {
    return {
      stakes: [],
      partial: true,
      errors: [`No working RPC for ${CHAINS[chain].label}`],
      savedAt: new Date().toISOString(),
    }
  }

  const head = await client.getBlockNumber()
  const fromBlock = HEX_LOG_FROM_BLOCK[chain]
  const label = CHAINS[chain].label

  const report = (from: bigint, to: bigint) =>
    onProgress?.({
      chain,
      address,
      fromBlock: from,
      toBlock: to,
      head,
      label: `${label} StakeEnd ${from.toString()}–${to.toString()}`,
    })

  const ends = await getLogsChunked(client, address, fromBlock, head, report)

  const stakes: StakeRow[] = []
  const seen = new Set<number>()
  for (const log of ends.logs) {
    const args = log.args
    if (args.data0 == null || args.data1 == null || args.stakeId == null) continue
    const end = decodeStakeEnd(args.data0, args.data1, BigInt(args.stakeId))
    if (seen.has(end.stakeId)) continue
    seen.add(end.stakeId)
    stakes.push(toStakeRow(end, hexUsd))
  }

  stakes.sort((a, b) => b.unlockedDay - a.unlockedDay || b.stakeId - a.stakeId)

  const savedAt = saveHistoryCache(chain, address, stakes, ends.partial)

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
      const result = await loadEndedHistory(chain, address, hexUsdByChain[chain], opts.onProgress)
      byKey[key] = result.stakes
      if (result.partial) partial = true
      errors.push(...result.errors.map((e) => `${CHAINS[chain].label} ${address.slice(0, 6)}…: ${e}`))
    }
  }

  return { byKey, partial, errors: errors.slice(0, 4) }
}
