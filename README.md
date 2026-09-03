# HEX Watch

Local **watch-only** tracker for HEX stakes on Ethereum and PulseChain.

You add public addresses. The app reads on-chain stake data over public RPCs and stores your watchlist on this device. It never asks for seed phrases, private keys, or wallet connection, and it cannot sign or broadcast transactions.

UI uses official HEX.COM brand tokens and fair-use logo assets from [hex.com/downloads](https://hex.com/downloads) (gradient, Poppins/Jost, HEXagon). This app is **unofficial** and not affiliated with HEX.COM.

## Not affiliated

This project is an independent build. It is **not** Staker, StakerApp, StakeView, or any private handoff package from another author. Do not copy proprietary source, branding, or docs from those projects into this repo.

## Run

```bash
npm install
npm run dev
```

## Install on phone (PWA)

Hosted on **GitHub Pages**. After the first deploy:

1. On the phone, open the Pages URL in **Chrome** (e.g. `https://ihelpmaybe.github.io/HEX-watch/`).
2. Menu → **Install app** / **Add to Home screen**.
3. Launch from the icon — works like a standalone app. Watchlist stays in that browser profile.

Local preview of the production build:

```bash
npm run build
npm run preview
```

## Deploy

Push to `main` (or `master`). The workflow in `.github/workflows/pages.yml` builds with `BASE_PATH=/<repo>/` and publishes `dist`.

In the GitHub repo: **Settings → Pages → Build and deployment → Source: GitHub Actions**.

## Stack

- React + Vite + TypeScript + PWA (`vite-plugin-pwa`)
- [viem](https://viem.sh) for read-only JSON-RPC
- HEX contract (public on-chain interface): `0x2b591e99afE9f32eAA6214f7B7629768c40Eeb39`

## Privacy

- Watchlist and labels stay in `localStorage`
- Network calls send only the public addresses you choose to public RPC endpoints
- No analytics SDK and no project backend in this MVP

## License

MIT — see `LICENSE`. Put your name in the copyright line before publishing.
