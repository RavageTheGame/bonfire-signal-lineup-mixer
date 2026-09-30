# Bonfire Signal · Issue lineup mixer

Live lineup tool for Deb: pick 1 Bonfire View, 4 Team takes, and 1 Field Note from **Notion Signal Pieces**, with an email-accurate preview.

## Why Vercel (not GitHub Pages)

GitHub Pages is static — it cannot hold a Notion secret or query Pieces on each open. This app hosts:

- The mixer UI (email-matched preview + masthead)
- `GET /api/pieces` — reads Signal Pieces **live** from Notion (short in-memory cache, ~20s)
- Refresh on window focus / tab visibility + a light 45s client poll (not a cron job)
- `POST /api/notion-webhook` — optional Notion webhook to invalidate cache immediately

## Env

| Variable | Required | Purpose |
|---|---|---|
| `NOTION_TOKEN` | Yes for live sync | Notion internal integration secret with access to Signal Pieces |
| `NOTION_PIECES_DATABASE_ID` | No | Defaults to Signal Pieces `7b8dc4d7-c313-4bda-923d-0ecaa0b4b610` |
| `NOTION_WEBHOOK_SECRET` | No | If set, webhook requests must include it |
| `PIECES_CACHE_TTL_MS` | No | Server cache TTL (default `20000`) |

Without `NOTION_TOKEN`, `/api/pieces` falls back to `public/pieces.json`.

## Local

```bash
npm install
NOTION_TOKEN=secret_xxx npm run dev
```

Open http://localhost:3000

## Notion embed

Embed the production URL on Signal Command. Picks stay in the browser (`localStorage`); Pieces stay live via the API.
