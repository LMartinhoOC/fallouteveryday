require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const fs   = require('fs');
const path = require('path');

const QUOTES_FILE = path.join(__dirname, '../data/quotes.json');
const STATE_FILE  = path.join(__dirname, '../data/state.json');
const MOCK_MODE   = process.env.MOCK_MODE === 'true';

function getClient() {
  const { TwitterApi } = require('twitter-api-v2');
  return new TwitterApi({
    appKey:       process.env.X_API_KEY,
    appSecret:    process.env.X_API_SECRET,
    accessToken:  process.env.X_ACCESS_TOKEN,
    accessSecret: process.env.X_ACCESS_TOKEN_SECRET,
  });
}

function readState() {
  return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
}

function writeState(state) {
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

// 402/429/5xx costumam ser falhas transitórias do lado da X API — vale retry.
// 4xx de auth/validação (401/403/400) não se resolvem tentando de novo.
const RETRYABLE_CODES = [402, 429, 500, 502, 503, 504];
const RETRY_BACKOFF_MS = [4000, 10000];
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function tweetWithRetry(rwClient, text) {
  const attempts = RETRY_BACKOFF_MS.length + 1;
  for (let i = 0; i < attempts; i++) {
    try {
      return await rwClient.v2.tweet({ text });
    } catch (err) {
      const isLast = i === attempts - 1;
      if (!RETRYABLE_CODES.includes(err.code) || isLast) throw err;
      const wait = RETRY_BACKOFF_MS[i];
      console.warn(`[bot] tweet falhou (HTTP ${err.code}) — retry ${i + 1}/${attempts - 1} em ${wait / 1000}s...`);
      await sleep(wait);
    }
  }
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
    const result   = await tweetWithRetry(rwClient, tweet);
    tweetId = result.data.id;
    console.log(`[bot] Tweet publicado! ID: ${tweetId}`);
  }

  state.posted.push({ id: entry.id, tweetId, postedAt: new Date().toISOString() });
  writeState(state);

  return { tweetId, entry };
}

module.exports = { postNext };

if (require.main === module) {
  postNext().catch(err => {
    const detail = err.code ? ` [HTTP ${err.code}] ${JSON.stringify(err.data)}` : '';
    console.error(`::error::[bot] erro fatal: ${err.message}${detail}`);
    process.exit(1);
  });
}
