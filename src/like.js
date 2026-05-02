require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const MOCK_MODE    = process.env.MOCK_MODE === 'true';
const BOT_USER_ID  = process.env.X_USER_ID;
const LOOKBACK_MS  = 24 * 60 * 60 * 1000;
const MIN_WAIT_MS  = 800;
const MAX_WAIT_MS  = 3_500;
const MAX_REPLIES  = 9;          // 1 OP + até 9 replies = 10 likes/round
const TOP_OP_POOL  = 3;          // sorteia entre os top 3 por reply_count

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

function fmt(t, usersById) {
  const u      = usersById?.get?.(t.author_id);
  const handle = u ? `@${u.username}` : `id:${t.author_id}`;
  const url    = u ? `https://x.com/${u.username}/status/${t.id}`
                   : `https://x.com/i/status/${t.id}`;
  const text   = (t.text || '').replace(/\s+/g, ' ').slice(0, 100);
  const m      = t.public_metrics || {};
  return `${handle} likes=${m.like_count || 0} replies=${m.reply_count || 0} rt=${m.retweet_count || 0} | ${url}\n           "${text}"`;
}

async function pickFromHomeTimeline(client) {
  const res = await client.v2.homeTimeline({
    max_results: 50,
    exclude: ['retweets', 'replies'],
    'tweet.fields': ['public_metrics', 'created_at', 'lang', 'possibly_sensitive', 'author_id', 'text'],
    expansions: ['author_id'],
    'user.fields': ['username'],
  });

  const tweets    = res.data?.data || [];
  const usersById = new Map((res.data?.includes?.users || []).map(u => [u.id, u]));
  const cutoff    = Date.now() - LOOKBACK_MS;

  const eligible = tweets.filter(t =>
    t.lang === 'en' &&
    !t.possibly_sensitive &&
    t.author_id !== BOT_USER_ID &&
    new Date(t.created_at).getTime() > cutoff
  );

  if (!eligible.length) return { op: null, usersById };

  // Ordena por reply_count desc, tiebreak por like_count
  eligible.sort((a, b) => {
    const ra = a.public_metrics?.reply_count || 0;
    const rb = b.public_metrics?.reply_count || 0;
    if (ra !== rb) return rb - ra;
    return (b.public_metrics?.like_count || 0) - (a.public_metrics?.like_count || 0);
  });

  // Sorteia entre os top N — fixar no #1 viraria padrão detectável
  const pool = eligible.slice(0, TOP_OP_POOL);
  const op   = pool[Math.floor(Math.random() * pool.length)];
  return { op, usersById };
}

async function fetchReplies(client, op, max = MAX_REPLIES) {
  const res = await client.v2.search(`conversation_id:${op.id} -is:retweet`, {
    max_results: 100,
    'tweet.fields': ['public_metrics', 'lang', 'author_id', 'possibly_sensitive', 'text'],
    expansions: ['author_id'],
    'user.fields': ['username'],
  });

  const tweets    = res.data?.data || [];
  const usersById = new Map((res.data?.includes?.users || []).map(u => [u.id, u]));

  const eligible = tweets
    .filter(t => t.id !== op.id)
    .filter(t => t.lang === 'en')
    .filter(t => !t.possibly_sensitive)
    .filter(t => t.author_id !== BOT_USER_ID)
    .sort((a, b) => (b.public_metrics?.like_count || 0) - (a.public_metrics?.like_count || 0))
    .slice(0, max);

  return { replies: eligible, usersById };
}

async function likeOne(client, tweet, usersById) {
  if (MOCK_MODE) {
    console.log(`[like] [MOCK] would like — ${fmt(tweet, usersById)}`);
    return;
  }
  await client.v2.like(BOT_USER_ID, tweet.id);
  console.log(`[like] LIKED — ${fmt(tweet, usersById)}`);
}

async function likeRound() {
  if (!BOT_USER_ID) {
    console.warn('[like] X_USER_ID não configurado — pulando round');
    return;
  }

  const client = getClient().readWrite;

  const { op, usersById: opUsers } = await pickFromHomeTimeline(client);
  if (!op) {
    console.log('[like] nenhum OP elegível na home timeline (24h, en, não-sensível)');
    return;
  }
  console.log(`[like] OP escolhido (top ${TOP_OP_POOL} por replies):\n           ${fmt(op, opUsers)}`);

  let replies = [];
  let replyUsers = new Map();
  try {
    const r = await fetchReplies(client, op);
    replies = r.replies;
    replyUsers = r.usersById;
    console.log(`[like] ${replies.length} reply(s) elegível(is) — likeando todas (cap=${MAX_REPLIES})`);
  } catch (e) {
    console.error(`[like] busca de replies falhou (${e.message}) — seguindo só com OP`);
  }

  const targets = [
    { tweet: op, users: opUsers },
    ...replies.map(t => ({ tweet: t, users: replyUsers })),
  ];

  for (let i = 0; i < targets.length; i++) {
    try {
      await likeOne(client, targets[i].tweet, targets[i].users);
    } catch (e) {
      console.error(`[like] falha em ${targets[i].tweet.id}: ${e.message}`);
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
