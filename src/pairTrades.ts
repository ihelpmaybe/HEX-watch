export type HexChartChain = 'pulsechain' | 'ethereum'

export type HexChartSource = 'dexscreener' | 'hexchart'

export type ChartFamily = 'hex' | 'hedron' | 'icosa' | 'com'

export interface HexChartTab {
  id: string
  label: string
  chain: HexChartChain
  source: HexChartSource
  family: ChartFamily
  dex: string
  /** Short note under the chart */
  blurb: string
  /** DexScreener pair address when source is dexscreener */
  pair?: string
  /** Full page / embed URL when source is hexchart (or other external) */
  url?: string
}

/** Main markets — HEX, then Hedron (HDRN), then Icosa (ICSA). */
export const HEX_CHARTS: HexChartTab[] = [
  // —— HEX / Pulse ——
  {
    id: 'pls-wpls',
    label: 'HEX/WPLS',
    pair: '0x19BB45a7270177e303DEe6eAA6F5Ad700812bA98',
    chain: 'pulsechain',
    source: 'dexscreener',
    family: 'hex',
    dex: 'PulseX v2',
    blurb: 'Main Pulse HEX / WPLS pool',
  },
  {
    id: 'pls-wpls-v1',
    label: 'HEX/WPLS v1',
    pair: '0xf1F4ee610b2bAbB05C635F726eF8B0C568c8dc65',
    chain: 'pulsechain',
    source: 'dexscreener',
    family: 'hex',
    dex: 'PulseX v1',
    blurb: 'Deep PulseX v1 HEX / WPLS',
  },
  {
    id: 'pls-usdc',
    label: 'HEX/USDC',
    pair: '0xC475332e92561CD58f278E4e2eD76c17D5b50f05',
    chain: 'pulsechain',
    source: 'dexscreener',
    family: 'hex',
    dex: 'PulseX',
    blurb: 'Pulse HEX priced in USDC',
  },
  {
    id: 'pls-dai',
    label: 'HEX/DAI',
    pair: '0x6F1747370B1CAcb911ad6D4477b718633DB328c8',
    chain: 'pulsechain',
    source: 'dexscreener',
    family: 'hex',
    dex: 'PulseX',
    blurb: 'Pulse HEX / bridged DAI',
  },
  {
    id: 'pls-plsx',
    label: 'HEX/PLSX',
    pair: '0x8268De0B539d1C03Fa693CA7EE47EAF70c8CD57D',
    chain: 'pulsechain',
    source: 'dexscreener',
    family: 'hex',
    dex: 'PulseX',
    blurb: 'HEX vs PulseX token',
  },
  // —— HEX / Ethereum ——
  {
    id: 'eth-weth',
    label: 'HEX/WETH',
    pair: '0x55D5c232D921B9eAA6b37b5845E439aCD04b4DBa',
    chain: 'ethereum',
    source: 'dexscreener',
    family: 'hex',
    dex: 'Uniswap',
    blurb: 'Ethereum HEX / WETH',
  },
  {
    id: 'eth-usdc',
    label: 'HEX/USDC',
    pair: '0xF6DCdce0ac3001B2f67F750bc64ea5beB37B5824',
    chain: 'ethereum',
    source: 'dexscreener',
    family: 'hex',
    dex: 'Uniswap',
    blurb: 'Ethereum HEX / USDC',
  },
  {
    id: 'ehex-hexchart',
    label: 'eHEX',
    chain: 'ethereum',
    source: 'hexchart',
    family: 'hex',
    dex: 'HEX Watch',
    url: 'https://hexchart.com/',
    blurb: 'Full history · dark · log · 4 dp',
  },
  // —— Hedron (HDRN) ——
  {
    id: 'hdrn-pls-hex',
    label: 'HDRN/HEX',
    pair: '0xa67F04E03194F3A1064f4FF4FF0f0f0144fD5EfF',
    chain: 'pulsechain',
    source: 'dexscreener',
    family: 'hedron',
    dex: 'PulseX',
    blurb: 'Pulse Hedron / HEX',
  },
  {
    id: 'hdrn-pls-wpls',
    label: 'HDRN/WPLS',
    pair: '0xbaE2b1aC914255AbE40eBE308458D592A0A9F44b',
    chain: 'pulsechain',
    source: 'dexscreener',
    family: 'hedron',
    dex: 'PulseX',
    blurb: 'Pulse Hedron / WPLS',
  },
  {
    id: 'hdrn-eth-hex',
    label: 'eHDRN/HEX',
    pair: '0x4A97b4Da0D43e1D36952e239cfDA8922e8643931',
    chain: 'ethereum',
    source: 'dexscreener',
    family: 'hedron',
    dex: 'Uniswap',
    blurb: 'Ethereum Hedron / HEX',
  },
  {
    id: 'hdrn-eth-weth',
    label: 'eHDRN/WETH',
    pair: '0x319E128C8FEbD6CE7eA0d4C51992a48040719758',
    chain: 'ethereum',
    source: 'dexscreener',
    family: 'hedron',
    dex: 'Uniswap',
    blurb: 'Ethereum Hedron / WETH',
  },
  // —— Icosa (ICSA) ——
  {
    id: 'icsa-pls-hex',
    label: 'ICSA/HEX',
    pair: '0xe5bb65e7a384D2671C96cfE1Ee9663F7B03a573e',
    chain: 'pulsechain',
    source: 'dexscreener',
    family: 'icosa',
    dex: 'PulseX',
    blurb: 'Pulse Icosa / HEX',
  },
  {
    id: 'icsa-pls-wpls',
    label: 'ICSA/WPLS',
    pair: '0x91454D72cFBA6190aC71D539d26eD40B6531BFE9',
    chain: 'pulsechain',
    source: 'dexscreener',
    family: 'icosa',
    dex: 'PulseX',
    blurb: 'Pulse Icosa / WPLS',
  },
  {
    id: 'icsa-eth-hex',
    label: 'eICSA/HEX',
    pair: '0x82de4Db279Ce9b7D8494aF416671EA9B6134ad03',
    chain: 'ethereum',
    source: 'dexscreener',
    family: 'icosa',
    dex: 'Uniswap',
    blurb: 'Ethereum Icosa / HEX',
  },
  {
    id: 'icsa-eth-hdrn',
    label: 'eICSA/HDRN',
    pair: '0x4676b75eEcf653C0A439b5744F52f70674e8Fb07',
    chain: 'ethereum',
    source: 'dexscreener',
    family: 'icosa',
    dex: 'Uniswap',
    blurb: 'Ethereum Icosa / Hedron',
  },
  // —— Communis (COM) — HEX staker incentive token ——
  {
    id: 'com-pls-hex',
    label: 'COM/HEX',
    pair: '0x5aDbcC7885311Fc621B3Ac59D685b355Ae4507F5',
    chain: 'pulsechain',
    source: 'dexscreener',
    family: 'com',
    dex: 'PulseX v2',
    blurb: 'Communis / HEX — Pulse',
  },
  {
    id: 'com-pls-wpls',
    label: 'COM/WPLS',
    pair: '0x5137A308Dbf822Aae9Fb34467633baaA516ed099',
    chain: 'pulsechain',
    source: 'dexscreener',
    family: 'com',
    dex: 'PulseX',
    blurb: 'Communis / WPLS — Pulse',
  },
  {
    id: 'com-eth-hex',
    label: 'eCOM/HEX',
    pair: '0x8FFdc8C69e1c1AFdbd4D37e9dF98EBA3e3Aca92D',
    chain: 'ethereum',
    source: 'dexscreener',
    family: 'com',
    dex: '9inch',
    blurb: 'Communis / HEX — Ethereum',
  },
  {
    id: 'com-eth-weth',
    label: 'eCOM/WETH',
    pair: '0x914B4613C07DB9e4239992CdcEA3e5a9936FD5A0',
    chain: 'ethereum',
    source: 'dexscreener',
    family: 'com',
    dex: '9inch',
    blurb: 'Communis / WETH — Ethereum',
  },
]

export const DEFAULT_HEX_CHART_ID = HEX_CHARTS[0].id

export const CHART_FAMILY_ROWS: { family: ChartFamily; label: string; aria: string }[] = [
  { family: 'hex', label: 'HEX', aria: 'HEX charts' },
  { family: 'hedron', label: 'Hedron', aria: 'Hedron HDRN charts' },
  { family: 'icosa', label: 'Icosa', aria: 'Icosa ICSA charts' },
  { family: 'com', label: 'COM', aria: 'Communis COM charts' },
]

export function chartsByFamily(family: ChartFamily): HexChartTab[] {
  return HEX_CHARTS.filter((c) => c.family === family)
}

export function hexChartById(id: string): HexChartTab {
  return HEX_CHARTS.find((c) => c.id === id) ?? HEX_CHARTS[0]
}

export function chartPageUrl(chart: HexChartTab): string {
  if (chart.source === 'hexchart') {
    return chart.url ?? 'https://hexchart.com/'
  }
  return `https://dexscreener.com/${chart.chain}/${chart.pair}`
}

/** Favorited DexScreener resolutions (TradingView codes). */
export const CHART_INTERVALS = [
  { id: '1D' as const, label: '1D' },
  { id: '1W' as const, label: '1W' },
  { id: '1M' as const, label: '1M' },
]

export type ChartIntervalId = (typeof CHART_INTERVALS)[number]['id']

export const DEFAULT_CHART_INTERVAL: ChartIntervalId = '1D'

export function chartEmbedUrl(
  chart: HexChartTab,
  interval: ChartIntervalId = DEFAULT_CHART_INTERVAL,
): string {
  if (chart.source === 'hexchart') {
    // Historical eHEX chart — site is its own UI; open dark-friendly root.
    return chart.url ?? 'https://hexchart.com/'
  }
  const q = new URLSearchParams({
    embed: '1',
    theme: 'dark',
    chartTheme: 'dark',
    trades: '1',
    info: '0',
    chartTimeframesToolbar: '1',
    // Don't restore prior light/linear prefs from this browser
    loadChartSettings: '0',
    interval,
  })
  return `${chartPageUrl(chart)}?${q.toString()}`
}

/** @deprecated */
export const PHEX_PAIR_ADDRESS = HEX_CHARTS[0].pair!
export const PHEX_DEX_URL = chartPageUrl(HEX_CHARTS[0])
export const PHEX_EMBED_URL = chartEmbedUrl(HEX_CHARTS[0])
