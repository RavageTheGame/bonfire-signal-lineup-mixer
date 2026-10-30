# Bonfire Signal · Issue lineup mixer

Issue-focused lineup tool for Deb. Bonnie prepares three ranked candidates for each of six slots (1 Bonfire View, 4 distinct Team takes, 1 Field Note). A Ready issue opens with the recommended draft; Deb can swap options and edit the existing Notion draft bodies.

## Current issue contract

Exactly one Signal Issues row must have **Active issue** checked. Its **Source start** and **Source end** are inclusive meeting dates, not page creation or edit dates. The API queries only that issue’s related Pieces and excludes undated, unranked, archived, mismatched, and out-of-period candidates. It returns at most three alternatives per slot. No active issue, conflicting active issues, invalid dates, or a disconnected Notion integration produce an empty working view with an explanation. Historical snapshot JSON is never substituted for current content.

Signal Issues fields: `Active issue` (checkbox), `Source start`, `Source end`, `Target send`, `Generated at` (dates), `Generation status` (select), and `Generation note` (rich text). Bonnie’s native run control uses `Run requested` (checkbox).

Signal Pieces fields: existing `Related Issue`, `Type`, `People`, `Status`, and draft body; plus `Mixer slot` (select), `Candidate rank` (number 1–3), `Ranking reason` (rich text), `Recommended` (checkbox), and `Source date` (latest supporting meeting date). Slot values are `Bonfire View`, `Team take 1`, `Team take 2`, `Team take 3`, `Team take 4`, and `Field Notes`.

The native Bonnie agent owns harvesting, source verification, ranking, scheduling, and generation. The mixer’s Generate link opens the active issue’s native controls. Generation must preserve provenance, human edits, and approval state; it must not send or publish a newsletter. Missing source coverage stays visible as a gap.

Picks are stored separately for each issue in this browser. A manually edited or cleared lineup survives refreshes; the old global lineup is not migrated. Past issues remain in the Notion archive. Saving a body after its Piece leaves the current issue is rejected with HTTP 409.

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

Without a connected Notion token, `/api/pieces` returns no candidates. The integration needs read access to both Issues and Pieces, and write access to Pieces for body editing.

## Local

```bash
npm install
NOTION_TOKEN=secret_xxx npm run dev
```

Open http://localhost:3000

## Notion embed

Embed the production URL on Signal Command. Picks stay in the browser (`localStorage`); Pieces stay live via the API.

## Verification

Run `npm test`, `npm run typecheck`, and `npm run build` with Node 22.15+ or Node 24. Tests cover issue isolation, inclusive source dates, missing metadata, three-option limits, contributor diversity, and stale saved picks.
