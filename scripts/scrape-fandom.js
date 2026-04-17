#!/usr/bin/env node
/**
 * scrape-fandom.js
 *
 * Scrapes Fallout character dialogue from the Fallout Fandom wiki (.txt pages)
 * via the MediaWiki API. Filters out placeholders and short/garbage lines,
 * deduplicates against data/quotes.json, then outputs to stdout or merges.
 *
 * Usage:
 *   node scripts/scrape-fandom.js                  # scrape all known characters
 *   node scripts/scrape-fandom.js Codsworth        # single character by name
 *   node scripts/scrape-fandom.js --merge          # merge into data/quotes.json
 *   node scripts/scrape-fandom.js Codsworth --merge
 */

const fs   = require('fs');
const path = require('path');

const QUOTES_FILE = path.join(__dirname, '../data/quotes.json');
const API_BASE    = 'https://fallout.fandom.com/api.php';
const DELAY_MS    = 350;

const GAMES = {
  FO4:  'Fallout 4',
  FONV: 'Fallout: New Vegas',
  FO3:  'Fallout 3',
};

// ---------------------------------------------------------------------------
// Character list — (page, character label, game)
// ---------------------------------------------------------------------------

const CHARACTERS = [
  // FO4 — Companions (base dialogue + companion-specific)
  { page: 'Codsworth.txt',               character: 'Codsworth',        game: GAMES.FO4 },
  { page: 'Codsworth.txt/COM',           character: 'Codsworth',        game: GAMES.FO4 },
  { page: 'CompanionCait.txt',           character: 'Cait',             game: GAMES.FO4 },
  { page: 'CompanionDeacon.txt',         character: 'Deacon',           game: GAMES.FO4 },
  { page: 'CompanionCurie.txt',          character: 'Curie',            game: GAMES.FO4 },
  { page: 'CompanionPiper.txt',          character: 'Piper Wright',     game: GAMES.FO4 },
  { page: 'CompanionNickValentine.txt',  character: 'Nick Valentine',   game: GAMES.FO4 },
  { page: 'CompanionMacCready.txt',      character: 'Robert MacCready', game: GAMES.FO4 },
  { page: 'Hancock.txt',                 character: 'John Hancock',     game: GAMES.FO4 },
  { page: 'Hancock.txt/COM',             character: 'John Hancock',     game: GAMES.FO4 },
  { page: 'PrestonGarvey.txt',           character: 'Preston Garvey',   game: GAMES.FO4 },
  { page: 'PrestonGarvey.txt/COM',       character: 'Preston Garvey',   game: GAMES.FO4 },
  { page: 'CompanionStrong.txt',         character: 'Strong',           game: GAMES.FO4 },
  { page: 'BoSPaladinDanse.txt',         character: 'Paladin Danse',    game: GAMES.FO4 },
  { page: 'BoSPaladinDanse.txt/COM',     character: 'Paladin Danse',    game: GAMES.FO4 },
  // FO4 — Robots & enemies
  { page: 'CreatureDialogueProtectron.txt', character: 'Protectron',    game: GAMES.FO4 },
  { page: 'CreatureDialogueMrHandy.txt', character: 'Mister Handy',     game: GAMES.FO4 },
  { page: 'CrMisterHandy.txt',           character: 'Mister Handy',     game: GAMES.FO4 },
  { page: 'CreatureDialogueAssaultron.txt', character: 'Assaultron',    game: GAMES.FO4 },
  { page: 'ConvGenericRaider.txt',       character: 'Raider',           game: GAMES.FO4 },
  { page: 'GenericRaider.txt',           character: 'Raider',           game: GAMES.FO4 },
  { page: 'CreatureDialogueSuperMutant.txt', character: 'Super Mutant', game: GAMES.FO4 },
  { page: 'CompanionX6-88.txt',          character: 'X6-88',            game: GAMES.FO4 },
  { page: 'LvlMinutemen.txt',            character: 'Minuteman',        game: GAMES.FO4 },
  // FO:NV — Companions
  { page: 'Veronica.txt',                character: 'Veronica',         game: GAMES.FONV },
  { page: 'VFSArcadeGannon.txt',         character: 'Arcade Gannon',    game: GAMES.FONV },
  { page: 'RaulTejada.txt',              character: 'Raul Tejada',      game: GAMES.FONV },
  { page: 'RoseofSharonCassidy.txt',     character: 'Cass',             game: GAMES.FONV },
  // FO:NV — Major NPCs
  { page: 'Benny.txt',                   character: 'Benny',            game: GAMES.FONV },
  { page: 'VMQTopsYesMan.txt',           character: 'Yes Man',          game: GAMES.FONV },
  { page: 'VHDYesMan.txt',               character: 'Yes Man',          game: GAMES.FONV },
  { page: 'NVCRMrHouse.txt',             character: 'Mr. House',        game: GAMES.FONV },
  { page: 'VHDLegionLegateLanius.txt',   character: 'Legate Lanius',    game: GAMES.FONV },
  { page: 'MrNewVegas.txt',              character: 'Mr. New Vegas',    game: GAMES.FONV },
  // FO:NV — DLC
  { page: 'NVDLC04Ulysses.txt',          character: 'Ulysses',          game: GAMES.FONV },
  { page: 'NVDLC02Joshua.txt',           character: 'Joshua Graham',    game: GAMES.FONV },
  // FO3
  { page: 'ThreeDog.txt',                character: 'Three Dog',        game: GAMES.FO3 },
  { page: 'BoSLibertyPrime.txt',         character: 'Liberty Prime',    game: GAMES.FO3 },
  { page: 'MQ11LibertyPrime.txt',        character: 'Liberty Prime',    game: GAMES.FO3 },
  // FO3 — Companions
  { page: 'MQ08Fawkes.txt',              character: 'Fawkes',           game: GAMES.FO3 },
  { page: 'Charon.txt',                  character: 'Charon',           game: GAMES.FO3 },
  { page: 'StarPaladinCross.txt',        character: 'Star Paladin Cross', game: GAMES.FO3 },
  { page: 'Butch.txt',                   character: 'Butch DeLoria',    game: GAMES.FO3 },
  // FO3 — NPCs
  { page: 'ColonelAutumn.txt',           character: 'Colonel Autumn',   game: GAMES.FO3 },
  { page: 'MoiraBrown.txt',              character: 'Moira Brown',      game: GAMES.FO3 },
  { page: 'Harold.txt',                  character: 'Harold',           game: GAMES.FO3 },
  { page: 'AllistairTenpenny.txt',       character: 'Alistair Tenpenny', game: GAMES.FO3 },
  { page: 'Pinkerton.txt',               character: 'Pinkerton',        game: GAMES.FO3 },
  { page: 'MisterBurke.txt',             character: 'Mister Burke',     game: GAMES.FO3 },
  { page: 'MayorMacCready.txt',          character: 'MacCready (kid)',  game: GAMES.FO3 },
  { page: 'ConfessorCromwell.txt',       character: 'Confessor Cromwell', game: GAMES.FO3 },
  // FO:NV — More companions
  { page: 'CraigBoone.txt',              character: 'Craig Boone',      game: GAMES.FONV },
  { page: 'NVCompanionEdE.txt',          character: 'ED-E',             game: GAMES.FONV },
  { page: 'NVDLC04EDE.txt',              character: 'ED-E',             game: GAMES.FONV },
  { page: 'Lily.txt',                    character: 'Lily Bowen',       game: GAMES.FONV },
  // FO:NV — More NPCs
  { page: 'FortCaesar.txt',              character: 'Caesar',           game: GAMES.FONV },
  { page: 'VDialogueCaesarsLegionMilitary.txt', character: 'Legion Soldier', game: GAMES.FONV },
  { page: 'VMQTopsSwank.txt',            character: 'Swank',            game: GAMES.FONV },
  { page: 'GSSunnySmiles.txt',           character: 'Sunny Smiles',     game: GAMES.FONV },
  { page: 'VRRCPapaKhan.txt',            character: 'Papa Khan',        game: GAMES.FONV },
  { page: 'VFSSecuritronGreeter.txt',    character: 'Victor',           game: GAMES.FONV },
  // FO4 — More NPCs
  { page: 'InstituteScientist.txt',      character: 'Institute Scientist', game: GAMES.FO4 },
  { page: 'SynthGen3.txt',               character: 'Synth',            game: GAMES.FO4 },
  { page: 'EncSecurityDiamondCity.txt',  character: 'Diamond City Security', game: GAMES.FO4 },
  { page: 'Dogmeat.txt',                 character: 'Dogmeat',          game: GAMES.FO4 },
  { page: 'Takahashi.txt',               character: 'Takahashi',        game: GAMES.FO4 },
];

// ---------------------------------------------------------------------------
// Wikitext helpers
// ---------------------------------------------------------------------------

function stripMarkup(text) {
  return text
    .replace(/\[\[(?:[^|\]]*\|)?([^\]]+)\]\]/g, '$1') // [[link|label]] → label
    .replace(/'{2,3}/g, '')                             // '' ''' (bold/italic)
    .replace(/<[^>]+>/g, '')                            // HTML tags
    .replace(/{{[^}]+}}/g, '')                          // {{inline templates}}
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .trim();
}

// Emotion tags like ''{Neutral}'' or ''{Sarcastic - stage direction / Tag}''
// These always appear as ''{ ... }'' at the start of a response
const EMOTION_TAG = /^''\{[^}]*\}''\s*/;

// Placeholders that mean the line isn't a standalone quote
const PLACEHOLDER = /<(?:PlayerName|Alias:|Global:|Topic:)|(?:\[Sound:|\[MALE|\[FEMALE|\[PLAYER)/i;

function cleanResponse(raw) {
  let text = raw
    .replace(EMOTION_TAG, '')       // strip emotion tag prefix
    .replace(/^"(.*)"$/, '$1')      // strip surrounding "quotes"
    .replace(/^'(.*)'$/, '$1')      // strip surrounding 'quotes'
    .trim();
  return stripMarkup(text);
}

function isUsable(text) {
  if (text.length < 30 || text.length > 240) return false;
  if (PLACEHOLDER.test(text))                return false;
  if (/^[\d\s.,!?;:-]+$/.test(text))         return false; // only punctuation/numbers
  if (/^\{[^}]+\}$/.test(text))              return false; // pure stage direction
  return true;
}

// ---------------------------------------------------------------------------
// Parser A — FO4 format
// Each row is a single line: {{Dialogue FO4|row\t|response=...\t|after=...}}
// ---------------------------------------------------------------------------

function parseDialogueFO4(wikitext) {
  const results = [];

  for (const line of wikitext.split('\n')) {
    if (!line.includes('{{Dialogue ') || !line.includes('|row')) continue;

    // Stop at: tab+pipe, or known params (|after= |abxy= |scene= |topic= etc.), or end of template
    const respMatch = line.match(/\|response=(.*?)(?=\t\|[a-z]|\|(?:after|abxy|srow|trow|scene|topic|before|linkable)=|\}\}$|$)/);
    if (!respMatch) continue;

    const raw  = respMatch[1].trim();
    if (!raw)  continue;

    const text = cleanResponse(raw);
    if (isUsable(text)) results.push(text);
  }

  return results;
}

// ---------------------------------------------------------------------------
// Parser B — FO:NV / FO3 table format
//
// Pages use a wikitext table where each row has columns:
//   TOPIC | PROMPT | EMOTION | RESPONSE TEXT | #
//
// The response cell ends with {{Inline quote|sound=xxx.ogg}}
// Stage directions appear inline as ''{...}'' throughout the text
// ---------------------------------------------------------------------------

// Strip ALL ''{...}'' stage direction blocks (NV has them inline, not just at start)
const STAGE_BLOCKS = /''\{[^}]*\}''\s*/g;

function cleanResponseNV(raw) {
  // Remove trailing {{Inline quote|...}} sound reference
  let text = raw.replace(/\{\{Inline quote\|[^}]*\}\}\s*$/, '');
  // Remove all stage direction blocks
  text = text.replace(STAGE_BLOCKS, '');
  // Remove surrounding quotes
  text = text.replace(/^"(.*)"$/, '$1').replace(/^'(.*)'$/, '$1');
  return stripMarkup(text);
}

function parseDialogueNV(wikitext) {
  const results  = [];
  const lines    = wikitext.split('\n');

  // We track table cells: after a |- row separator, cells come as lines starting with |
  // The response text cell is the one containing {{Inline quote|sound=
  for (const line of lines) {
    const trimmed = line.trim();

    // A table cell containing a sound reference = response text cell
    if (!trimmed.startsWith('|') || trimmed.startsWith('|-') || trimmed.startsWith('||')) continue;
    if (!trimmed.includes('{{Inline quote|sound=')) continue;

    // Strip leading | only — the response cell never starts with rowspan/colspan
    const cellContent = trimmed.slice(1).trim();

    const text = cleanResponseNV(cellContent);
    if (isUsable(text)) results.push(text);
  }

  return results;
}

// ---------------------------------------------------------------------------
// Auto-detect format and parse
// FO4 format always has {{Dialogue FO4|row (or FO3/FNV/etc.)
// NV table format has np-table-dialogue and never has {{Dialogue XX|row
// ---------------------------------------------------------------------------

function parseDialogue(wikitext) {
  if (/\{\{Dialogue [A-Z0-9]+\|row/.test(wikitext)) return parseDialogueFO4(wikitext);
  if (wikitext.includes('{{Inline quote|sound='))     return parseDialogueNV(wikitext);
  return parseDialogueFO4(wikitext);
}

// ---------------------------------------------------------------------------
// API fetch with User-Agent
// ---------------------------------------------------------------------------

async function fetchWikitext(page) {
  const url = `${API_BASE}?action=parse&page=${encodeURIComponent(page)}&prop=wikitext&format=json`;
  const res  = await fetch(url, {
    headers: { 'User-Agent': 'fallout-quotes-bot/1.0 (educational/non-commercial)' },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
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
  const args   = process.argv.slice(2);
  const merge  = args.includes('--merge');
  const filter = args.filter(a => a !== '--merge').map(a => a.toLowerCase());

  // Resolve target list
  const targets = filter.length > 0
    ? CHARACTERS.filter(c => filter.some(f => c.character.toLowerCase().includes(f) || c.page.toLowerCase().includes(f)))
    : CHARACTERS;

  if (targets.length === 0) {
    process.stderr.write(`No characters matched: ${filter.join(', ')}\n`);
    process.stderr.write(`Known: ${[...new Set(CHARACTERS.map(c => c.character))].join(', ')}\n`);
    process.exit(1);
  }

  // Load existing quotes for deduplication
  const existing    = JSON.parse(fs.readFileSync(QUOTES_FILE, 'utf8'));
  const existingSet = new Set(existing.quotes.map(q => q.quote.toLowerCase().trim()));
  let   nextId      = Math.max(...existing.quotes.map(q => q.id), 0) + 1;

  const fresh = [];

  for (let i = 0; i < targets.length; i++) {
    const { page, character, game } = targets[i];
    process.stderr.write(`[${i + 1}/${targets.length}] ${character} (${page})… `);

    try {
      const wikitext = await fetchWikitext(page);
      const lines    = parseDialogue(wikitext);
      let   added    = 0;

      for (const quote of lines) {
        const key = quote.toLowerCase().trim();
        if (existingSet.has(key)) continue;
        existingSet.add(key);
        fresh.push({ id: nextId++, quote, character, game, lastPostedAt: null });
        added++;
      }

      process.stderr.write(`${lines.length} parsed, ${added} new\n`);
    } catch (err) {
      process.stderr.write(`ERROR: ${err.message}\n`);
    }

    if (i < targets.length - 1) await sleep(DELAY_MS);
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
  console.error(err.message);
  process.exit(1);
});
