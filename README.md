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
| `NOTION_ISSUES_DATABASE_ID` | No | Defaults to Signal Issues `eecbb144-5f06-4827-a647-031e9b9cdad8` |
| `NOTION_WEBHOOK_SECRET` | No | If set, webhook requests must include it |
| `PIECES_CACHE_TTL_MS` | No | Server cache TTL (default `20000`) |

Bonnie and Signal Command own issue creation, generation, and scheduling in Notion.
Bonnie writes individual drafts to the existing Signal Pieces database, with their
Type, People, Related Issue, and copy under a `Draft body` heading. Existing Option
toggles remain supported. The mixer continues to provide picking, previewing, and
body editing.

Exactly one Signal Issues row must have the `Active issue` checkbox selected.
The mixer queries only Pieces related to that issue and uses its title in the
email preview. Historical Pieces remain in Notion. Missing Notion access or an
ambiguous active issue returns an error instead of showing the old bundled copy.

## Local

```bash
npm install
NOTION_TOKEN=secret_xxx npm run dev
```

Open http://localhost:3000

## Notion embed

Embed the production URL on Signal Command. Picks stay in the browser (`localStorage`); Pieces stay live via the API.
