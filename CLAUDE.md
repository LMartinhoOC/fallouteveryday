# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**Fallout Quotes Bot** — a Twitter/X bot that posts one Fallout series quote per day, with a web panel to manage the queue. Rebranded from a dog photo bot; the architecture is preserved but the content focus is entirely Fallout game quotes.

## Commands

```bash
npm start          # Run both scheduler + web panel in a single process
npm run bot        # Trigger the bot once immediately (posts next pending item)
npm run scheduler  # Run only the cron scheduler
npm run panel      # Run only the web panel (port 3000)
```

No tests or linter configured.

## Architecture

Three modules run in one process via `start.js`:

- **`src/bot.js`** — Core posting logic. Reads `data/scheduled.json`, picks the oldest pending post with `scheduledAt <= now`, optionally uploads an image, then posts via `twitter-api-v2`. Updates post status to `posted`/`error`. Set `MOCK_MODE=true` to skip real API calls.
- **`src/scheduler.js`** — Wraps `bot.postNext()` in a `node-cron` job. Schedule controlled by `CRON_SCHEDULE` env var (default: `0 9 * * *`).
- **`panel/server.js`** — Express web server. Session-based auth via `PANEL_PASSWORD`. Serves `panel/public/` as a vanilla JS SPA and exposes a REST API for queue management.

**Data flow:**
1. Quotes live in `data/quotes.json` (master database, ~120 quotes, grows over time)
2. The bot queue lives in `data/scheduled.json` — one entry per scheduled tweet
3. Images go to `uploads/` (served at `/uploads/`); for a quotes-only bot this may be unused
4. Cron fires → `postNext()` reads the queue → posts to X → updates status in JSON

## Quote Database

`data/quotes.json` is the heart of the new project. Structure:

```json
{
  "_meta": { "sources": [...], "review_status": "DRAFT" },
  "quotes": [
    {
      "id": 1,
      "quote": "War. War never changes.",
      "character": "Narrator (Ron Perlman)",
      "game": "Fallout",
      "tags": ["iconic", "opening", "philosophical"]
    }
  ]
}
```

**Games covered (priority order):** Fallout: New Vegas → Fallout 3 → Fallout 4 → Fallout 1 → Fallout 2 → Fallout TV Series (2024)

**Tags used:** `iconic`, `meme`, `humor`, `dark humor`, `philosophical`, `short`, `emotional`, `villain`, `companion`, `political`, `dramatic`, `hopeful`, `survivor`, `TV`

**Status:** 120 quotes, DRAFT — needs human review before going live. Quotes marked with `_meta.review_status` flag.

## REST API (`panel/server.js`)

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/api/me` | No | Check session state |
| POST | `/api/login` | No | Password login |
| POST | `/api/logout` | Yes | Destroy session |
| GET | `/api/queue` | Yes | List all scheduled posts |
| POST | `/api/queue` | Yes | Add post (multipart, image optional, max 15 MB) |
| DELETE | `/api/queue/:id` | Yes | Remove pending/error post + its image |

Posts with status `posted` cannot be deleted via the UI.

## Environment Variables

Create `.env` in the project root:

```
X_API_KEY=
X_API_SECRET=
X_ACCESS_TOKEN=
X_ACCESS_TOKEN_SECRET=
PANEL_PASSWORD=
SESSION_SECRET=
CRON_SCHEDULE=0 9 * * *
PORT=3000
MOCK_MODE=false
```

## TODO / Next Steps

- [ ] Write a script to auto-populate `data/scheduled.json` from `data/quotes.json` (one quote per day going forward)
- [ ] Rewrite tweet format: `"[quote]" — [character], [game]` with optional hashtags
- [ ] Human review of `data/quotes.json` — remove any quotes that don't stand alone without game context
- [ ] Consider stripping the image upload UI since this bot is text-only
