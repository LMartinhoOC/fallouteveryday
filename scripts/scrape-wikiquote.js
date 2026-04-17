#!/usr/bin/env node
/**
 * scrape-wikiquote.js
 *
 * Scrapes Fallout quotes from Wikiquote via the MediaWiki API.
 * Outputs new quotes (not already in data/quotes.json) to stdout as JSON,
 * or merges directly into the file with --merge flag.
 *
 * Usage:
 *   node scripts/scrape-wikiquote.js                    # scrape all games
 *   node scripts/scrape-wikiquote.js "Fallout: New Vegas"
 *   node scripts/scrape-wikiquote.js --merge            # merge into quotes.json
 */

const fs   = require('fs');
const path = require('path');

const QUOTES_FILE = path.join(__dirname, '../data/quotes.json');

const PAGES = {
  'Fallout':           'Fallout',
  'Fallout 2':         'Fallout_2',
  'Fallout 3':         'Fallout_3',
  'Fallout: New Vegas': 'Fallout:_New_Vegas',
  'Fallout 4':         'Fallout_4',
};

// ---------------------------------------------------------------------------
// Wikitext parser
// ---------------------------------------------------------------------------

// Sections that are never character names
const SKIP_SECTIONS = new Set([
  'voice actors', 'cast', 'external links', 'see also', 'notes',
  'references', 'taglines', 'about', 'credits', 'sources',
  'reviews', 'reception', 'critical reception',
]);

// Character names that are obviously non-game-characters (press, meta, etc.)
const SKIP_CHARACTERS = /staff|review|magazine|editor|critic|journalist|about the game|narrator.*opening/i;

function stripMarkup(text) {
  return text
    .replace(/\[\[(?:[^|\]]*\|)?([^\]]+)\]\]/g, '$1') // [[link|label]] → label
    .replace(/'{2,3}/g, '')                             // '' ''' → bold/italic
    .replace(/<[^>]+>/g, '')                            // <ref>...</ref> etc
    .replace(/{{[^}]+}}/g, '')                          // {{templates}}
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .trim();
}

function parseWikitext(wikitext, game) {
  const lines   = wikitext.split('\n');
  const results = [];
  let   section = null;  // == top-level section ==
  let   character = null; // === sub-section === or ** attribution
  let   pending = null;  // last * quote waiting for possible ** attribution

  function flush() {
    if (!pending) return;
    const { quote, char } = pending;
    pending = null;
    const charName = char || 'Unknown';
    if (quote.length > 5 && quote.length <= 280 && !SKIP_CHARACTERS.test(charName)) {
      results.push({ quote, character: charName, game });
    }
  }

  for (const raw of lines) {
    const line = raw.trim();

    // == Top-level section ==
    const h2 = line.match(/^={2}([^=]+)={2}$/);
    if (h2) {
      flush();
      section   = stripMarkup(h2[1].trim()).toLowerCase();
      character = null;
      continue;
    }

    // === Character sub-section ===
    const h3 = line.match(/^={3}([^=]+)={3}$/);
    if (h3) {
      flush();
      character = stripMarkup(h3[1].trim());
      continue;
    }

    // Skip non-quote top-level sections entirely
    if (section && SKIP_SECTIONS.has(section)) continue;

    // * Quote (top-level bullet = the actual quote line)
    // Matches: "* text", "*text", "*[context] text" — but NOT "** attribution"
    if (line.startsWith('*') && !line.startsWith('**')) {
      flush();
      let raw = stripMarkup(line.slice(1).replace(/^\[.*?\]\s*/, '').trim());

      // Handle "Character: Quote text" pattern (common in "Others" sections)
      let char = character;
      const speakerMatch = raw.match(/^([A-Z][^:]{2,40}):\s+(.+)$/);
      if (speakerMatch) {
        char = speakerMatch[1].trim();
        raw  = speakerMatch[2].trim();
      }

      pending = { quote: raw, char };
      continue;
    }

    // ** Attribution  e.g. ** '''Frank Horrigan'''
    if (line.startsWith('**') && pending) {
      const attr = stripMarkup(line.slice(3).trim());
      // Attribution lines are often "Character" or "Character, Game (year)"
      // Take only the part before any comma/parenthesis
      const name = attr.split(/[,(]/)[0].trim();
      if (name.length > 0 && name.length < 60) {
        pending.char = name;
      }
      continue;
    }
  }

  flush();
  return results;
}

// ---------------------------------------------------------------------------
// MediaWiki API fetch
// ---------------------------------------------------------------------------

async function fetchWikitext(pageSlug) {
  const url = `https://en.wikiquote.org/w/api.php?action=parse&page=${encodeURIComponent(pageSlug)}&prop=wikitext&format=json&origin=*`;
  const res  = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${pageSlug}`);
  const data = await res.json();
  if (data.error) throw new Error(data.error.info);
  return data.parse.wikitext['*'];
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const args  = process.argv.slice(2);
  const merge = args.includes('--merge');

  // Which games to scrape
  const targets = args.filter(a => a !== '--merge');
  const games   = targets.length > 0
    ? Object.fromEntries(targets.map(g => [g, PAGES[g]]).filter(([, v]) => v))
    : PAGES;

  if (Object.keys(games).length === 0) {
    console.error('Unknown game(s):', targets.join(', '));
    console.error('Valid options:', Object.keys(PAGES).join(', '));
    process.exit(1);
  }

  // Load existing quotes to deduplicate
  const existing   = JSON.parse(fs.readFileSync(QUOTES_FILE, 'utf8'));
  const existingSet = new Set(existing.quotes.map(q => q.quote.toLowerCase().trim()));
  let   nextId     = Math.max(...existing.quotes.map(q => q.id), 0) + 1;

  const fresh = [];

  for (const [game, slug] of Object.entries(games)) {
    process.stderr.write(`Scraping ${game}…`);
    try {
      const wikitext = await fetchWikitext(slug);
      const parsed   = parseWikitext(wikitext, game);
      let   added    = 0;

      for (const entry of parsed) {
        const key = entry.quote.toLowerCase().trim();
        if (!existingSet.has(key)) {
          existingSet.add(key);
          fresh.push({ id: nextId++, ...entry, lastPostedAt: null });
          added++;
        }
      }

      process.stderr.write(` ${parsed.length} parsed, ${added} new\n`);
    } catch (err) {
      process.stderr.write(` ERROR: ${err.message}\n`);
    }
  }

  if (fresh.length === 0) {
    process.stderr.write('No new quotes found.\n');
    return;
  }

  if (merge) {
    existing.quotes.push(...fresh);
    existing._meta.total = existing.quotes.length;
    fs.writeFileSync(QUOTES_FILE, JSON.stringify(existing, null, 2));
    process.stderr.write(`Merged ${fresh.length} quotes into ${QUOTES_FILE}\n`);
  } else {
    console.log(JSON.stringify({ new_quotes: fresh.length, quotes: fresh }, null, 2));
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
