import { createPublicClient, formatEther, formatGwei, http } from 'viem'
import { mainnet } from 'viem/chains'
import { CHAINS, type ChainKey } from './hex'
import { money, type QuoteSet } from './quotes'

const HISTORY_KEY = 'hex-watch/gas-history/v1'
const MAX_SAMPLES = 48
/** Typical HEX stakeEnd weight used for cross-chain USD compare. */
export const REF_STAKE_END_GAS = 140_000n

const pulsechain = {
  id: 369,
  name: 'PulseChain',
  nativeCurrency: { name: 'Pulse', symbol: 'PLS', decimals: 18 },
  rpcUrls: { default: { http: ['https://rpc.pulsechain.com'] } },
} as const

export interface GasSample {
  at: string
  ethGwei: number | null
  plsGwei: number | null
  ethUsd: number | null
  plsUsd: number | null
  /** ethUsd / plsUsd when both known */
  premium: number | null
}

export interface GasBoard {
  ethGwei: number | null
  plsGwei: number | null
  ethUsd: number | null
  plsUsd: number | null
  premium: number | null
  premiumLabel: string
  history: GasSample[]
  sampledAt: string
}

function viemChain(chain: ChainKey) {
  return chain === 'ethereum' ? mainnet : pulsechain
}

async function gasPriceWei(chain: ChainKey): Promise<bigint | null> {
  const config = CHAINS[chain]
  for (const url of config.rpcUrls) {
    try {
      const client = createPublicClient({
        chain: viemChain(chain),
        transport: http(url, { timeout: 12_000, retryCount: 0 }),
      })
      return await client.getGasPrice()
    } catch {
      /* try next */
    }
  }
  return null
}

export function loadGasHistory(): GasSample[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as GasSample[]
    return Array.isArray(parsed) ? parsed.slice(-MAX_SAMPLES) : []
  } catch {
    return []
  }
}

function saveGasHistory(samples: GasSample[]) {
  localStorage.setItem(HISTORY_KEY, JSON.stringify(samples.slice(-MAX_SAMPLES)))
}

function usdForUnits(weiPrice: bigint | null, units: bigint, nativeUsd: number | null): number | null {
  if (weiPrice == null || nativeUsd == null) return null
  const native = Number(formatEther(weiPrice * units))
  if (!Number.isFinite(native)) return null
  return native * nativeUsd
}

function premiumLabel(ethUsd: number | null, plsUsd: number | null): string {
  if (ethUsd == null || plsUsd == null || plsUsd <= 0) return 'ETH vs PLS compare unavailable'
  const ratio = ethUsd / plsUsd
  const extra = ethUsd - plsUsd
  if (!Number.isFinite(ratio) || ratio <= 0) return 'ETH vs PLS compare unavailable'
  const ratioText =
    ratio >= 100
      ? `${Math.round(ratio).toLocaleString()}×`
      : ratio >= 10
        ? `${ratio.toFixed(0)}×`
        : `${ratio.toFixed(1)}×`
  return `ETH is ~${ratioText} Pulse · +${money(extra)} on ETH`
}

/** One dual-chain gas read per sync. Stores history locally. */
export async function loadGasBoard(quotes: QuoteSet): Promise<GasBoard> {
  const [ethWei, plsWei] = await Promise.all([gasPriceWei('ethereum'), gasPriceWei('pulsechain')])
  const ethGwei = ethWei != null ? Number(formatGwei(ethWei)) : null
  const plsGwei = plsWei != null ? Number(formatGwei(plsWei)) : null
  const ethUsd = usdForUnits(ethWei, REF_STAKE_END_GAS, quotes.ethUsd)
  const plsUsd = usdForUnits(plsWei, REF_STAKE_END_GAS, quotes.plsUsd)
  const premium =
    ethUsd != null && plsUsd != null && plsUsd > 0 ? ethUsd / plsUsd : null
  const sampledAt = new Date().toISOString()
  const sample: GasSample = {
    at: sampledAt,
    ethGwei,
    plsGwei,
    ethUsd,
    plsUsd,
    premium,
  }
  const history = [...loadGasHistory(), sample].slice(-MAX_SAMPLES)
  saveGasHistory(history)

  return {
    ethGwei,
    plsGwei,
    ethUsd,
    plsUsd,
    premium,
    premiumLabel: premiumLabel(ethUsd, plsUsd),
    history,
    sampledAt,
  }
}

export function formatGasCompare(board: GasBoard | null): {
  ethUsd: string
  plsUsd: string
  premiumLabel: string
  ratioLabel: string
  ethGwei: string
  plsGwei: string
} {
  if (!board) {
    return {
      ethUsd: '—',
      plsUsd: '—',
      premiumLabel: 'Gas compare pending sync',
      ratioLabel: '—',
      ethGwei: '—',
      plsGwei: '—',
    }
  }
  const ratio =
    board.ethUsd != null && board.plsUsd != null && board.plsUsd > 0
      ? board.ethUsd / board.plsUsd
      : null
  const ratioLabel =
    ratio != null && Number.isFinite(ratio) && ratio > 0
      ? ratio >= 10
        ? `${Math.round(ratio)}×`
        : `${ratio.toFixed(1)}×`
      : '—'
  return {
    ethUsd: money(board.ethUsd),
    plsUsd: money(board.plsUsd, 4),
    premiumLabel: premiumLabel(board.ethUsd, board.plsUsd),
    ratioLabel,
    ethGwei:
      board.ethGwei != null
        ? `${board.ethGwei.toLocaleString(undefined, { maximumFractionDigits: 2 })} gwei`
        : '—',
    plsGwei:
      board.plsGwei != null
        ? `${board.plsGwei.toLocaleString(undefined, { maximumFractionDigits: 4 })} gwei`
        : '—',
  }
}
