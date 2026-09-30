# Bonfire Signal — Issue Lineup Mixer

Embeddable preview for Deb to mix Signal Pieces into an Issue 03 lineup.

## Live URL

**GitHub Pages:** https://ravagethegame.github.io/bonfire-signal-lineup-mixer/

## Use in Notion

1. Open [Signal Command](https://app.notion.com/p/3e59dd857da1812c82f6cc782758948e)
2. Open **Issue Lineup Mixer** (child page) — or add an **Embed** block pointing at the Pages URL above
3. Offline / paste option: open `signal-lineup-mixer-notion.html` (self-contained with inline Pieces; works without network fetch)

## What it does

- Pulls candidates from Notion **Signal Pieces** (Big Idea / Team take / Field Notes)
- Pick **1** Bonfire View, **4** Team takes, **1** Field Note
- Preview uses Signal email layout (navy/ember, numbered sections, partner cards)
- Bylines use partner full names (e.g. Mark → Mark Mullen)
- **In this issue** row lists featured contributors in order of appearance

## Sync

`pieces.json` is harvested from live Notion via the Bonfire project agent (42 of 45 bodies as of last sync). Re-run sync after new Piece drafts land, then refresh the hosted files.
