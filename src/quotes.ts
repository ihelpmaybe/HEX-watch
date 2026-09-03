import { createPublicClient, http, type Address, type PublicClient } from 'viem'
import { mainnet } from 'viem/chains'
import { CHAINS, type ChainKey } from './hex'

export interface QuoteSet {
  hexUsd: number | null
  hexEth: number | null
  hexPls: number | null
  ethUsd: number | null
  plsUsd: number | null
  hdrnUsd: number | null
  comUsd: number | null
  source: string
}

const pulsechain = {
  id: 369,
  name: 'PulseChain',
  nativeCurrency: { name: 'Pulse', symbol: 'PLS', decimals: 18 },
  rpcUrls: { default: { http: ['https://rpc.pulsechain.com'] } },
} as const

const PAIR_ABI = [
  {
    type: 'function',
    name: 'getReserves',
    stateMutability: 'view',
    inputs: [],
    outputs: [
      { name: 'reserve0', type: 'uint112' },
      { name: 'reserve1', type: 'uint112' },
      { name: 'blockTimestampLast', type: 'uint32' },
    ],
  },
  {
    type: 'function',
    name: 'token0',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'address' }],
  },
] as const

const CHAINLINK_ABI = [
  {
    type: 'function',
    name: 'latestRoundData',
    stateMutability: 'view',
    inputs: [],
    outputs: [
      { name: 'roundId', type: 'uint80' },
      { name: 'answer', type: 'int256' },
      { name: 'startedAt', type: 'uint256' },
      { name: 'updatedAt', type: 'uint256' },
      { name: 'answeredInRound', type: 'uint80' },
    ],
  },
  {
    type: 'function',
    name: 'decimals',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'uint8' }],
  },
] as const

const HEX = '0x2b591e99afE9f32eAA6214f7B7629768c40Eeb39' as const
const HDRN = '0x3819f64f282bf135d62168C1e513280dAF905e06' as const
const COM = '0x5A9780Bfe63f3ec57f01b087cD65BD656C9034A8' as const
const WETH = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2' as const
const USDC_ETH = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48' as const
const WPLS = '0xA1077a294dDE1B09bB078844df40758a5D0f9a27' as const
/** Pulsebridged USDC on PulseChain */
const USDC_PLS = '0x15D38573d2feeb82e7ad5187aB8c1D52810B1f07' as const
const CHAINLINK_ETH_USD = '0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419' as const

/** Verified Uniswap V2 / PulseX pools (deepest useful liquidity). */
const PAIRS = {
  ethereum: {
    hexUsdc: '0xF6DCdce0ac3001B2f67F750bc64ea5beB37B5824' as Address,
    hexWeth: '0x55D5c232D921B9eAA6b37b5845E439aCD04b4DBa' as Address,
    hdrnHex: '0x035a397725D3c9fc5Ddd3E56066B7b64C749014e' as Address,
    hdrnWeth: '0x319E128C8FEbD6CE7eA0d4C51992a48040719758' as Address,
    comHex: '0x8FFdc8C69e1c1AFdbd4D37e9dF98EBA3e3Aca92D' as Address,
  },
  pulsechain: {
    /** PulseX V2 */
    hexWpls: '0x19BB45a7270177e303DEe6eAA6F5Ad700812bA98' as Address,
    hdrnWpls: '0xbaE2b1aC914255AbE40eBE308458D592A0A9F44b' as Address,
    hdrnHex: '0xa67F04E03194F3A1064f4FF4FF0f0f0144fD5EfF' as Address,
    comHex: '0x5aDbcC7885311Fc621B3Ac59D685b355Ae4507F5' as Address,
    comWpls: '0x5137A308Dbf822Aae9Fb34467633baaA516ed099' as Address,
    /** PulseX V1 — deeper WPLS/USDC */
    wplsUsdc: '0x6753560538ECa67617A9Ce605178F788bE7E524E' as Address,
  },
} as const

function empty(source = 'none'): QuoteSet {
  return {
    hexUsd: null,
    hexEth: null,
    hexPls: null,
    ethUsd: null,
    plsUsd: null,
    hdrnUsd: null,
    comUsd: null,
    source,
  }
}

function finite(n: number | null | undefined): number | null {
  return n != null && Number.isFinite(n) && n > 0 ? n : null
}

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
      /* try next */
    }
  }
  return null
}

async function pairSpot(
  client: PublicClient,
  pair: Address,
  base: Address,
  quote: Address,
  baseDecimals: number,
  quoteDecimals: number,
): Promise<number | null> {
  try {
    const [token0, reserves] = await Promise.all([
      client.readContract({ address: pair, abi: PAIR_ABI, functionName: 'token0' }),
      client.readContract({ address: pair, abi: PAIR_ABI, functionName: 'getReserves' }),
    ])
    const r0 = reserves[0]
    const r1 = reserves[1]
    const baseIs0 = token0.toLowerCase() === base.toLowerCase()
    const quoteIs0 = token0.toLowerCase() === quote.toLowerCase()
    if (!baseIs0 && !quoteIs0) return null
    const baseRaw = baseIs0 ? r0 : r1
    const quoteRaw = baseIs0 ? r1 : r0
    if (baseRaw === 0n) return null
    // Fixed-point: quote per 1 base, 1e18 resolution.
    const fixed =
      (quoteRaw * 10n ** BigInt(18 + baseDecimals)) / (baseRaw * 10n ** BigInt(quoteDecimals))
    return finite(Number(fixed) / 1e18)
  } catch {
    return null
  }
}

async function chainlinkEthUsd(client: PublicClient): Promise<number | null> {
  try {
    const [round, decimals] = await Promise.all([
      client.readContract({
        address: CHAINLINK_ETH_USD,
        abi: CHAINLINK_ABI,
        functionName: 'latestRoundData',
      }),
      client.readContract({
        address: CHAINLINK_ETH_USD,
        abi: CHAINLINK_ABI,
        functionName: 'decimals',
      }),
    ])
    const answer = Number(round[1]) / 10 ** Number(decimals)
    return finite(answer)
  } catch {
    return null
  }
}

async function loadEthereumQuotes(): Promise<QuoteSet> {
  const client = await clientFor('ethereum')
  if (!client) return empty('rpc-fail')

  const [ethUsd, hexUsdDirect, hexEth, hdrnPerHex, hdrnEth, comPerHex] = await Promise.all([
    chainlinkEthUsd(client),
    pairSpot(client, PAIRS.ethereum.hexUsdc, HEX, USDC_ETH, 8, 6),
    pairSpot(client, PAIRS.ethereum.hexWeth, HEX, WETH, 8, 18),
    pairSpot(client, PAIRS.ethereum.hdrnHex, HDRN, HEX, 9, 8),
    pairSpot(client, PAIRS.ethereum.hdrnWeth, HDRN, WETH, 9, 18),
    pairSpot(client, PAIRS.ethereum.comHex, COM, HEX, 12, 8),
  ])

  const hexUsd =
    finite(hexUsdDirect) ??
    (finite(hexEth) && finite(ethUsd) ? hexEth! * ethUsd! : null)
  const hexEthOut =
    finite(hexEth) ?? (finite(hexUsd) && finite(ethUsd) ? hexUsd! / ethUsd! : null)
  const hdrnUsd =
    (finite(hdrnPerHex) && finite(hexUsd) ? hdrnPerHex! * hexUsd! : null) ??
    (finite(hdrnEth) && finite(ethUsd) ? hdrnEth! * ethUsd! : null)
  const comUsd = finite(comPerHex) && finite(hexUsd) ? comPerHex! * hexUsd! : null

  return {
    hexUsd,
    hexEth: hexEthOut,
    hexPls: null,
    ethUsd,
    plsUsd: null,
    hdrnUsd,
    comUsd,
    source: 'on-chain · UniV2 + Chainlink',
  }
}

async function loadPulseQuotes(): Promise<QuoteSet> {
  const client = await clientFor('pulsechain')
  if (!client) return empty('rpc-fail')

  const [plsUsd, hexPerPls, hdrnPerPls, hdrnPerHex, comPerHex, comPerPls] = await Promise.all([
    pairSpot(client, PAIRS.pulsechain.wplsUsdc, WPLS, USDC_PLS, 18, 6),
    pairSpot(client, PAIRS.pulsechain.hexWpls, HEX, WPLS, 8, 18),
    pairSpot(client, PAIRS.pulsechain.hdrnWpls, HDRN, WPLS, 9, 18),
    pairSpot(client, PAIRS.pulsechain.hdrnHex, HDRN, HEX, 9, 8),
    pairSpot(client, PAIRS.pulsechain.comHex, COM, HEX, 12, 8),
    pairSpot(client, PAIRS.pulsechain.comWpls, COM, WPLS, 12, 18),
  ])

  const hexUsd = finite(hexPerPls) && finite(plsUsd) ? hexPerPls! * plsUsd! : null
  const hdrnUsd =
    (finite(hdrnPerPls) && finite(plsUsd) ? hdrnPerPls! * plsUsd! : null) ??
    (finite(hdrnPerHex) && finite(hexUsd) ? hdrnPerHex! * hexUsd! : null)
  const comUsd =
    (finite(comPerHex) && finite(hexUsd) ? comPerHex! * hexUsd! : null) ??
    (finite(comPerPls) && finite(plsUsd) ? comPerPls! * plsUsd! : null)

  return {
    hexUsd,
    hexEth: null,
    hexPls: finite(hexPerPls),
    ethUsd: null,
    plsUsd,
    hdrnUsd,
    comUsd,
    source: 'on-chain · PulseX',
  }
}

export async function loadQuotes(chainKey: ChainKey): Promise<QuoteSet> {
  return chainKey === 'ethereum' ? loadEthereumQuotes() : loadPulseQuotes()
}

/** One dual-chain on-chain quote pass per sync. */
export async function loadQuotesBoth(): Promise<Record<ChainKey, QuoteSet>> {
  const [ethereum, pulsechain] = await Promise.all([loadEthereumQuotes(), loadPulseQuotes()])
  return { ethereum, pulsechain }
}

export function money(usd: number | null, digits = 2): string {
  if (usd == null || !Number.isFinite(usd)) return '—'
  return usd.toLocaleString(undefined, {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: digits,
  })
}

export function ethAmt(eth: number | null): string {
  if (eth == null || !Number.isFinite(eth)) return '—'
  return `${eth.toLocaleString(undefined, { maximumFractionDigits: 6 })} ETH`
}
