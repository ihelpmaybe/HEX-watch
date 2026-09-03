import { createPublicClient, http, type PublicClient } from 'viem'
import { mainnet } from 'viem/chains'
import { CHAINS, HEX_ADDRESS, HEX_READ_ABI, type ChainKey } from './hex'
import { decodeDailyPayout } from './hexMath'
import { money } from './quotes'

/** HEX: shares minted = hearts * 1e5 / shareRate. UI T-Share = 1e12 share units. */
const TSHARE_UNITS = 1_000_000_000_000n // 1e12

export interface TshareSnap {
  chain: ChainKey
  shareRate: number
  /** HEX per 1 T-Share */
  hexPerTshare: number | null
  usdPerTshare: number | null
  /** Prior completed day payout for 1 T-Share, in HEX */
  payoutHex: number | null
  payoutUsd: number | null
}

const pulsechain = {
  id: 369,
  name: 'PulseChain',
  nativeCurrency: { name: 'Pulse', symbol: 'PLS', decimals: 18 },
  rpcUrls: { default: { http: ['https://rpc.pulsechain.com'] } },
} as const

async function clientFor(chain: ChainKey): Promise<PublicClient | null> {
  const config = CHAINS[chain]
  const viemChain = chain === 'ethereum' ? mainnet : pulsechain
  for (const url of config.rpcUrls) {
    try {
      const client = createPublicClient({
        chain: viemChain,
        transport: http(url, { timeout: 14_000, retryCount: 0 }),
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

function empty(chain: ChainKey): TshareSnap {
  return {
    chain,
    shareRate: 0,
    hexPerTshare: null,
    usdPerTshare: null,
    payoutHex: null,
    payoutUsd: null,
  }
}

/**
 * HEX per T-Share = (1e12 shares * shareRate / 1e5) / 1e8 hearts-per-HEX
 *                = shareRate / 10
 */
function hexPerTshareFromRate(shareRate: bigint): number | null {
  if (shareRate <= 0n) return null
  return Number(shareRate) / 10
}

/** Live T-Share price + prior-day payout for one chain. */
export async function loadTshareSnap(
  chain: ChainKey,
  hexUsd: number | null,
): Promise<TshareSnap> {
  const client = await clientFor(chain)
  if (!client) return empty(chain)

  try {
    const [globals, currentDay] = await Promise.all([
      client.readContract({
        address: HEX_ADDRESS,
        abi: HEX_READ_ABI,
        functionName: 'globals',
      }),
      client.readContract({
        address: HEX_ADDRESS,
        abi: HEX_READ_ABI,
        functionName: 'currentDay',
      }),
    ])

    const shareRate = BigInt(globals[2])
    const hexPer = hexPerTshareFromRate(shareRate)

    let payoutHex: number | null = null
    if (currentDay > 0n) {
      const begin = currentDay - 1n
      const packed = await client.readContract({
        address: HEX_ADDRESS,
        abi: HEX_READ_ABI,
        functionName: 'dailyDataRange',
        args: [begin, currentDay],
      })
      if (packed.length > 0) {
        const hearts = decodeDailyPayout(packed[0], TSHARE_UNITS)
        payoutHex = Number(hearts) / 1e8
      }
    }

    return {
      chain,
      shareRate: Number(shareRate),
      hexPerTshare: hexPer,
      usdPerTshare:
        hexPer != null && hexUsd != null && Number.isFinite(hexUsd) ? hexPer * hexUsd : null,
      payoutHex,
      payoutUsd:
        payoutHex != null && hexUsd != null && Number.isFinite(hexUsd)
          ? payoutHex * hexUsd
          : null,
    }
  } catch {
    return empty(chain)
  }
}

export async function loadTshareBoth(hexUsdByChain: {
  ethereum: number | null
  pulsechain: number | null
}): Promise<Record<ChainKey, TshareSnap>> {
  const [ethereum, pulsechain] = await Promise.all([
    loadTshareSnap('ethereum', hexUsdByChain.ethereum),
    loadTshareSnap('pulsechain', hexUsdByChain.pulsechain),
  ])
  return { ethereum, pulsechain }
}

export function fmtTshareHex(n: number | null): string {
  if (n == null || !Number.isFinite(n)) return '—'
  if (n >= 1000) return n.toLocaleString(undefined, { maximumFractionDigits: 0 })
  if (n >= 1) return n.toLocaleString(undefined, { maximumFractionDigits: 2 })
  return n.toLocaleString(undefined, { maximumFractionDigits: 4 })
}

export function fmtTshareUsd(n: number | null): string {
  return money(n, n != null && Math.abs(n) < 1 ? 4 : 2)
}

/** Stake shares raw → T-Share count (1e12 units). */
export function sharesToTshares(sharesRaw: string | number | bigint): number {
  const n = typeof sharesRaw === 'bigint' ? Number(sharesRaw) : Number(sharesRaw)
  if (!Number.isFinite(n) || n <= 0) return 0
  return n / 1e12
}
