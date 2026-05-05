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

module.exports = { postNext };

if (require.main === module) {
  postNext().catch(err => {
    console.error('[bot] erro fatal:', err.message);
    process.exit(1);
  });
}
