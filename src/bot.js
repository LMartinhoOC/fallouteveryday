require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const fs   = require('fs');
const path = require('path');

const QUOTES_FILE = path.join(__dirname, '../data/quotes.json');
const STATE_FILE  = path.join(__dirname, '../data/state.json');
const MOCK_MODE   = process.env.MOCK_MODE === 'true';

const REVEAL_DELAY_MIN_MS = 90_000;   // 1.5min
const REVEAL_DELAY_MAX_MS = 240_000;  // 4min

function getClient() {
  const { TwitterApi } = require('twitter-api-v2');
  return new TwitterApi({
    appKey:       process.env.X_API_KEY,
    appSecret:    process.env.X_API_SECRET,
    accessToken:  process.env.X_ACCESS_TOKEN,
    accessSecret: process.env.X_ACCESS_TOKEN_SECRET,
  });
}

// "Narrator (Ron Perlman)" -> "narrator"; "MacCready (kid)" -> "maccready"
// Returns null if name é vazio ou só whitespace após cleanup.
function sanitizeCharacter(name) {
  if (!name) return null;
  const cleaned = name.replace(/\s*\([^)]*\)\s*$/, '').trim();
  return cleaned ? cleaned.toLowerCase() : null;
}

function readState() {
  return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
}

function writeState(state) {
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

async function postNext() {
  const data  = JSON.parse(fs.readFileSync(QUOTES_FILE, 'utf8'));
  const state = readState();

  let entry;

  // Pinned queue tem prioridade
  if (state.pinned?.length > 0) {
    const pinnedId = state.pinned[0];
    entry = data.quotes.find(q => q.id === pinnedId);
    if (entry) {
      state.pinned = state.pinned.slice(1);
    }
  }

  // Fallback: aleatório dos não postados
  if (!entry) {
    const postedIds = new Set(state.posted.map(p => p.id));
    const unposted  = data.quotes.filter(q => !postedIds.has(q.id));
    const pool      = unposted.length > 0 ? unposted : data.quotes;
    entry = pool[Math.floor(Math.random() * pool.length)];
  }
  const tweet = entry.quote.toLowerCase();

  console.log(`[bot] ${MOCK_MODE ? '[MOCK] ' : ''}Postando "${tweet.slice(0, 60).replace(/\n/g, ' ')}…"`);

  let tweetId;

  if (MOCK_MODE) {
    await new Promise(r => setTimeout(r, 600));
    tweetId = `MOCK_${Date.now()}`;
    console.log(`[bot] [MOCK] Tweet simulado! ID: ${tweetId}`);
    console.log(`[bot] [MOCK] Conteúdo:\n${tweet}`);
  } else {
    const rwClient = getClient().readWrite;
    const result   = await rwClient.v2.tweet({ text: tweet });
    tweetId = result.data.id;
    console.log(`[bot] Tweet publicado! ID: ${tweetId}`);
  }

  state.posted.push({ id: entry.id, tweetId, postedAt: new Date().toISOString() });
  writeState(state);

  return { tweetId, entry };
}

async function postReveal(parentTweetId, entry) {
  const character = sanitizeCharacter(entry.character);
  if (!character) {
    console.log('[bot] reveal pulado (character vazio após sanitize)');
    return null;
  }

  console.log(`[bot] ${MOCK_MODE ? '[MOCK] ' : ''}Reveal: "${character}"`);

  let revealId;
  if (MOCK_MODE) {
    await new Promise(r => setTimeout(r, 300));
    revealId = `MOCK_REVEAL_${Date.now()}`;
    console.log(`[bot] [MOCK] Reveal simulado! ID: ${revealId}`);
  } else {
    const rwClient = getClient().readWrite;
    const result   = await rwClient.v2.reply(character, parentTweetId);
    revealId = result.data.id;
    console.log(`[bot] Reveal publicado! ID: ${revealId}`);
  }

  // Atualiza última entry do state com revealId
  const state = readState();
  const last  = state.posted[state.posted.length - 1];
  if (last && last.tweetId === parentTweetId) {
    last.revealId = revealId;
    writeState(state);
  }

  return revealId;
}

async function runCycle() {
  const { tweetId, entry } = await postNext();

  // No MOCK_MODE pulamos o sleep longo pra agilizar dev
  const delayMs = MOCK_MODE
    ? 500
    : REVEAL_DELAY_MIN_MS + Math.floor(Math.random() * (REVEAL_DELAY_MAX_MS - REVEAL_DELAY_MIN_MS));

  console.log(`[bot] aguardando ${Math.round(delayMs / 1000)}s antes do reveal...`);
  await new Promise(r => setTimeout(r, delayMs));

  try {
    await postReveal(tweetId, entry);
  } catch (err) {
    // Best-effort: post original já tá no ar e gravado em state. Reveal falhar não é fatal.
    console.error('[bot] reveal falhou (post original ok):', err.message);
  }
}

module.exports = { postNext, postReveal, runCycle, sanitizeCharacter };

if (require.main === module) {
  runCycle().catch(err => {
    console.error('[bot] erro fatal:', err.message);
    process.exit(1);
  });
}
