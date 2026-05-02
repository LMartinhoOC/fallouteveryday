require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const MOCK_MODE    = process.env.MOCK_MODE === 'true';
const BOT_USER_ID  = process.env.X_USER_ID;
const LOOKBACK_MS  = 6 * 60 * 60 * 1000;
const MIN_WAIT_MS  = 800;
const MAX_WAIT_MS  = 3_500;
const MAX_REPLIES  = 3;

function getClient() {
  const { TwitterApi } = require('twitter-api-v2');
  return new TwitterApi({
    appKey:       process.env.X_API_KEY,
    appSecret:    process.env.X_API_SECRET,
    accessToken:  process.env.X_ACCESS_TOKEN,
    accessSecret: process.env.X_ACCESS_TOKEN_SECRET,
  });
}

const sleep  = ms => new Promise(r => setTimeout(r, ms));
const jitter = (min, max) => Math.floor(min + Math.random() * (max - min));

async function pickFromHomeTimeline(client) {
  const res = await client.v2.homeTimeline({
    max_results: 20,
    exclude: ['retweets', 'replies'],
    'tweet.fields': ['public_metrics', 'created_at', 'lang', 'possibly_sensitive', 'author_id'],
  });

  const tweets = res.data?.data || [];
  const cutoff = Date.now() - LOOKBACK_MS;

  const eligible = tweets.filter(t =>
    t.lang === 'en' &&
    !t.possibly_sensitive &&
    t.author_id !== BOT_USER_ID &&
    new Date(t.created_at).getTime() > cutoff
  );

  if (!eligible.length) return null;
  return eligible[Math.floor(Math.random() * eligible.length)];
}

async function topReplies(client, op, max = MAX_REPLIES) {
  const res = await client.v2.search(`conversation_id:${op.id} -is:retweet`, {
    max_results: 20,
    'tweet.fields': ['public_metrics', 'lang', 'author_id', 'possibly_sensitive'],
  });

  const tweets = res.data?.data || [];
  return tweets
    .filter(t => t.id !== op.id)
    .filter(t => t.lang === 'en')
    .filter(t => !t.possibly_sensitive)
    .filter(t => t.author_id !== BOT_USER_ID)
    .sort((a, b) => (b.public_metrics?.like_count || 0) - (a.public_metrics?.like_count || 0))
    .slice(0, max);
}

async function likeOne(client, tweetId) {
  if (MOCK_MODE) {
    console.log(`[like] [MOCK] daria like em ${tweetId}`);
    return;
  }
  await client.v2.like(BOT_USER_ID, tweetId);
  console.log(`[like] like em ${tweetId}`);
}

async function likeRound() {
  if (!BOT_USER_ID) {
    console.warn('[like] X_USER_ID não configurado — pulando round');
    return;
  }

  const client = getClient().readWrite;

  const op = await pickFromHomeTimeline(client);
  if (!op) {
    console.log('[like] nenhum OP elegível na home timeline (filtros: en, fresh, não-sensível)');
    return;
  }
  console.log(`[like] OP escolhido: id=${op.id} autor=${op.author_id} likes=${op.public_metrics?.like_count}`);

  let replies = [];
  try {
    replies = await topReplies(client, op);
    console.log(`[like] ${replies.length} reply(s) elegível(is)`);
  } catch (e) {
    console.error(`[like] busca de replies falhou (${e.message}) — seguindo só com OP`);
  }

  const targets = [op, ...replies];

  for (let i = 0; i < targets.length; i++) {
    try {
      await likeOne(client, targets[i].id);
    } catch (e) {
      console.error(`[like] falha em ${targets[i].id}: ${e.message}`);
    }
    if (i < targets.length - 1) {
      const wait = jitter(MIN_WAIT_MS, MAX_WAIT_MS);
      console.log(`[like] aguardando ${(wait / 1000).toFixed(1)}s`);
      await sleep(wait);
    }
  }
}

module.exports = { likeRound };

if (require.main === module) {
  likeRound().catch(err => {
    console.error('[like] fatal:', err.message);
    process.exit(1);
  });
}
