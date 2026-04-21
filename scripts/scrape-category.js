#!/usr/bin/env node
/**
 * scrape-category.js
 *
 * Auto-discovers dialogue pages from the Fallout wiki's Category:Dialogue_files
 * subcategories, then scrapes and parses each page for quotes.
 *
 * Unlike scrape-fandom.js (which has a hardcoded character list), this script
 * walks the entire category to find pages we haven't scraped yet.
 *
 * Usage:
 *   node scripts/scrape-category.js                       # FO4 + FONV + FO3, dry-run (stdout)
 *   node scripts/scrape-category.js --merge               # merge new quotes into quotes.json
 *   node scripts/scrape-category.js --game FO4            # single game
 *   node scripts/scrape-category.js --game FONV --game FO3
 *   node scripts/scrape-category.js --limit 20            # max 20 pages per game (for testing)
 *   node scripts/scrape-category.js --list                # only list discovered pages, don't scrape
 *
 * A JSON report is always saved to data/scrape-report-<timestamp>.json with
 * per-page stats: page title, character, wiki URL, quotes parsed, quotes added.
 */

const fs   = require('fs');
const path = require('path');

const QUOTES_FILE = path.join(__dirname, '../data/quotes.json');
const API_BASE    = 'https://fallout.fandom.com/api.php';
const DELAY_MS    = 400;

const GAME_CATEGORIES = [
  { key: 'FO4',  category: 'Fallout 4 dialogue files',         game: 'Fallout 4' },
  { key: 'FONV', category: 'Fallout: New Vegas dialogue files', game: 'Fallout: New Vegas' },
  { key: 'FO3',  category: 'Fallout 3 dialogue files',         game: 'Fallout 3' },
  { key: 'NUKA', category: 'Nuka-World dialogue files',        game: 'Fallout 4' },
];

// ---------------------------------------------------------------------------
// Character name inference from wiki page title
// ---------------------------------------------------------------------------

// Applied repeatedly until stable — order matters for specificity
const STRIP_PREFIXES = [
  /^NVDLC\d{2}/,           // NVDLC04Ulysses → Ulysses
  /^FO4DLC\d{2}/,
  /^DLC\d{2}/,
  /^MQ\d{2,3}/,            // MQ08Fawkes → Fawkes
  /^BoS[A-Z]\d+/,           // BoSM01KnightAstlin → KnightAstlin
  /^BoS\d+/,               // BoS301BrotherHenri → BrotherHenri
  /^BoS(?=[A-Z])/,         // BoSElderMaxson → ElderMaxson (lookahead, don't consume next char)
  /^CreatureDialogue/,     // CreatureDialogueMrHandy → MrHandy
  /^Creature/,
  /^Companion/,            // CompanionCait → Cait
  /^ConvGeneric/,          // ConvGenericRaider → Raider
  /^Conv/,
  /^Generic/,
  /^Dialogue/,             // DialogueGeneric (after BoS stripped) → Generic
  /^Lvl/,                  // LvlMinutemen → Minutemen
  /^VDialogue/,
  /^VHD/,                  // VHDYesMan → YesMan → Yes Man
  /^VMQ[A-Z][a-z]+(?=[A-Z])/,  // VMQTopsYesMan → YesMan (strip location code, keep name)
  /^VMQ/,
  /^VFS/,                  // VFSArcadeGannon → ArcadeGannon
  /^VRR[A-Z]/,
  /^V[A-Z]{2,5}/,          // catch-all for V+uppercase prefix
  /^GS/,                   // GSSunnySmiles → SunnySmiles
  /^NPC/,
  /^Enc[A-Z]/,             // EncSecurityDiamondCity → SecurityDiamondCity
  /^\d{3}/,                // 188Alexander → Alexander
  /^[A-Z0-9]{2,4}(?=[A-Z][a-z])/, // residual all-caps prefix before CamelWord
];

function inferCharacter(pageName) {
  // Remove .txt, subpage suffix, and internal spaces (some titles have spaces)
  let name = pageName.replace(/\.txt.*$/i, '').replace(/\s+/g, '');

  // Repeatedly strip prefixes until stable
  let changed = true;
  while (changed) {
    changed = false;
    for (const re of STRIP_PREFIXES) {
      const stripped = name.replace(re, '');
      if (stripped !== name && stripped.length >= 3) {
        name = stripped;
        changed = true;
        break;
      }
    }
  }

  // Split CamelCase: "ArcadeGannon" → "Arcade Gannon"
  name = name
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]{2,})([A-Z][a-z])/g, '$1 $2');

  name = name.replace(/\s+/g, ' ').trim();

  return name.length >= 2 ? name : pageName.replace(/\.txt.*$/i, '');
}

// ---------------------------------------------------------------------------
// Wikitext helpers (copied from scrape-fandom.js)
// ---------------------------------------------------------------------------

function stripMarkup(text) {
  return text
    .replace(/\[\[(?:[^|\]]*\|)?([^\]]+)\]\]/g, '$1')
    .replace(/'{2,3}/g, '')
    .replace(/<[^>]+>/g, '')
    .replace(/{{[^}]+}}/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .trim();
}

const EMOTION_TAG  = /^''\{[^}]*\}''\s*/;
const STAGE_BLOCKS = /''\{[^}]*\}''\s*/g;
const PLACEHOLDER  = /<(?:PlayerName|Alias:|Global:|Topic:)|(?:\[Sound:|\[MALE|\[FEMALE|\[PLAYER)/i;

function cleanResponse(raw) {
  return stripMarkup(
    raw.replace(EMOTION_TAG, '').replace(/^"(.*)"$/, '$1').replace(/^'(.*)'$/, '$1').trim()
  );
}

function cleanResponseNV(raw) {
  return stripMarkup(
    raw.replace(/\{\{Inline quote\|[^}]*\}\}\s*$/, '')
       .replace(STAGE_BLOCKS, '')
       .replace(/^"(.*)"$/, '$1').replace(/^'(.*)'$/, '$1')
  );
}

function isUsable(text) {
  if (text.length < 30 || text.length > 240) return false;
  if (PLACEHOLDER.test(text))                return false;
  if (/^[\d\s.,!?;:-]+$/.test(text))         return false;
  if (/^\{[^}]+\}$/.test(text))              return false;
  if (/^\[(?:SUCCEEDED|FAILED|Barter|Speech|Science|Repair|Medicine|Survival|Lockpick|Explosives|Guns|Energy|Melee|Unarmed|Sneak|Steal|Throwing|Outdoorsman)\b/i.test(text)) return false;
  return true;
}

function parseDialogueFO4(wikitext) {
  const results = [];
  for (const line of wikitext.split('\n')) {
    if (!line.includes('{{Dialogue ') || !line.includes('|row')) continue;
    const m = line.match(/\|response=(.*?)(?=\t\|[a-z]|\|(?:after|abxy|srow|trow|scene|topic|before|linkable)=|\}\}$|$)/);
    if (!m) continue;
    const raw = m[1].trim();
    if (!raw) continue;
    const text = cleanResponse(raw);
    if (isUsable(text)) results.push(text);
  }
  return results;
}

function parseDialogueNV(wikitext) {
  const results = [];
  for (const line of wikitext.split('\n')) {
    const t = line.trim();
    if (!t.startsWith('|') || t.startsWith('|-') || t.startsWith('||')) continue;
    if (!t.includes('{{Inline quote|sound=')) continue;
    const text = cleanResponseNV(t.slice(1).trim());
    if (isUsable(text)) results.push(text);
  }
  return results;
}

function parseDialogue(wikitext) {
  if (/\{\{Dialogue [A-Z0-9]+\|row/.test(wikitext)) return parseDialogueFO4(wikitext);
  if (wikitext.includes('{{Inline quote|sound='))    return parseDialogueNV(wikitext);
  return parseDialogueFO4(wikitext);
}

// ---------------------------------------------------------------------------
// API helpers
// ---------------------------------------------------------------------------

const FETCH_HEADERS = { 'User-Agent': 'fallout-quotes-bot/1.0 (educational/non-commercial)' };

async function apiFetch(params) {
  const url = `${API_BASE}?${new URLSearchParams({ format: 'json', ...params })}`;
  const res  = await fetch(url, { headers: FETCH_HEADERS });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function fetchCategoryPages(category) {
  const pages = [];
  let cmcontinue = null;

  do {
    const params = {
      action: 'query',
      list: 'categorymembers',
      cmtitle: `Category:${category}`,
      cmtype: 'page',
      cmlimit: '500',
      ...(cmcontinue && { cmcontinue }),
    };
    const data = await apiFetch(params);
    pages.push(...(data.query?.categorymembers ?? []));
    cmcontinue = data.continue?.cmcontinue ?? null;
    if (cmcontinue) await sleep(DELAY_MS);
  } while (cmcontinue);

  return pages;
}

async function fetchWikitext(page) {
  const data = await apiFetch({ action: 'parse', page, prop: 'wikitext' });
  if (data.error) throw new Error(data.error.info);
  return data.parse.wikitext['*'];
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const args  = process.argv.slice(2);
  const merge = args.includes('--merge');
  const list  = args.includes('--list');

  // --game KEY (repeatable)
  const gameKeys = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--game' && args[i + 1]) gameKeys.push(args[++i].toUpperCase());
  }

  // --limit N
  let limit = Infinity;
  const li = args.indexOf('--limit');
  if (li !== -1 && args[li + 1]) limit = parseInt(args[li + 1], 10);

  const targets = gameKeys.length > 0
    ? GAME_CATEGORIES.filter(g => gameKeys.includes(g.key))
    : GAME_CATEGORIES;

  if (targets.length === 0) {
    process.stderr.write(`Unknown game key(s): ${gameKeys.join(', ')}\n`);
    process.stderr.write(`Valid: ${GAME_CATEGORIES.map(g => g.key).join(', ')}\n`);
    process.exit(1);
  }

  // Load existing quotes for deduplication
  const existing    = JSON.parse(fs.readFileSync(QUOTES_FILE, 'utf8'));
  const existingSet = new Set(existing.quotes.map(q => q.quote.toLowerCase().trim()));
  let   nextId      = Math.max(...existing.quotes.map(q => q.id), 0) + 1;

  const fresh = [];
  const stats = []; // per-page: { game, page, character, url, parsed, added, error? }

  for (const { key, category, game } of targets) {
    process.stderr.write(`\n[${key}] Fetching page list from "${category}"…\n`);

    let pages;
    try {
      pages = await fetchCategoryPages(category);
    } catch (err) {
      process.stderr.write(`  ERROR fetching category: ${err.message}\n`);
      continue;
    }

    // Only .txt pages (some categories include non-dialogue pages)
    const dialoguePages = pages.filter(p => /\.txt/i.test(p.title));
    process.stderr.write(`  Found ${dialoguePages.length} dialogue pages\n`);

    if (list) {
      for (const p of dialoguePages) {
        const url = `https://fallout.fandom.com/wiki/${encodeURIComponent(p.title.replace(/ /g, '_'))}`;
        process.stdout.write(`${p.title}\t${inferCharacter(p.title)}\t${url}\n`);
      }
      continue;
    }

    const batch = dialoguePages.slice(0, limit);

    for (let i = 0; i < batch.length; i++) {
      const { title }  = batch[i];
      const character  = inferCharacter(title);
      const pageUrl    = `https://fallout.fandom.com/wiki/${encodeURIComponent(title.replace(/ /g, '_'))}`;
      process.stderr.write(`  [${i + 1}/${batch.length}] ${title}… `);

      try {
        const wikitext = await fetchWikitext(title);
        const lines    = parseDialogue(wikitext);
        let   added    = 0;

        for (const quote of lines) {
          const k = quote.toLowerCase().trim();
          if (existingSet.has(k)) continue;
          existingSet.add(k);
          fresh.push({ id: nextId++, quote, character, game });
          added++;
        }

        process.stderr.write(`${lines.length} parsed, ${added} new\n`);
        stats.push({ game, page: title, character, url: pageUrl, parsed: lines.length, added });
      } catch (err) {
        process.stderr.write(`ERROR: ${err.message}\n`);
        stats.push({ game, page: title, character, url: pageUrl, parsed: 0, added: 0, error: err.message });
      }

      if (i < batch.length - 1) await sleep(DELAY_MS);
    }
  }

  if (list) return;

  // ---------------------------------------------------------------------------
  // Summary + report
  // ---------------------------------------------------------------------------

  // Aggregate by game
  const byGame = {};
  for (const s of stats) {
    if (!byGame[s.game]) byGame[s.game] = { pages: 0, parsed: 0, added: 0 };
    byGame[s.game].pages  += 1;
    byGame[s.game].parsed += s.parsed;
    byGame[s.game].added  += s.added;
  }

  const totals = { pages: stats.length, parsed: 0, added: 0 };
  for (const g of Object.values(byGame)) { totals.parsed += g.parsed; totals.added += g.added; }

  // Print human-readable summary to stderr
  const n = (x) => x.toLocaleString().padStart(7);
  process.stderr.write('\n=== SUMMARY ===\n');
  for (const [gameName, g] of Object.entries(byGame)) {
    process.stderr.write(`  ${gameName.padEnd(25)} ${n(g.pages)} pages | ${n(g.parsed)} parsed | ${n(g.added)} new\n`);
  }
  process.stderr.write(`  ${'TOTAL'.padEnd(25)} ${n(totals.pages)} pages | ${n(totals.parsed)} parsed | ${n(totals.added)} new\n`);

  // Save JSON report
  const timestamp  = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const reportFile = path.join(__dirname, `../data/scrape-report-${timestamp}.json`);
  const report     = { timestamp: new Date().toISOString(), totals, byGame, pages: stats };
  fs.writeFileSync(reportFile, JSON.stringify(report, null, 2));
  process.stderr.write(`\nReport saved: ${reportFile}\n`);

  if (fresh.length === 0) {
    process.stderr.write('No new quotes found.\n');
    return;
  }

  if (merge) {
    existing.quotes.push(...fresh);
    existing._meta.total = existing.quotes.length;
    fs.writeFileSync(QUOTES_FILE, JSON.stringify(existing, null, 2));
    process.stderr.write(`Merged into ${QUOTES_FILE} (total: ${existing.quotes.length})\n`);
  } else {
    console.log(JSON.stringify({ new_quotes: fresh.length, quotes: fresh }, null, 2));
  }
}

main().catch(err => {
  console.error(err.message);
  process.exit(1);
});
