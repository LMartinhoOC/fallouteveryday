/**
 * Busca os últimos tweets da conta do bot via Twitter API e preenche
 * o state.json com os posts que ainda não estão registrados.
 *
 * Uso: node scripts/backfill-state.js [--max 100] [--dry-run]
 */

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const fs   = require('fs');
const path = require('path');
const { TwitterApi } = require('twitter-api-v2');

const QUOTES_FILE = path.join(__dirname, '../data/quotes.json');
const STATE_FILE  = path.join(__dirname, '../data/state.json');

const args    = process.argv.slice(2);
const maxResults = parseInt(args[args.indexOf('--max') + 1]) || 100;
const dryRun  = args.includes('--dry-run');

async function main() {
  const client = new TwitterApi({
    appKey:       process.env.X_API_KEY,
    appSecret:    process.env.X_API_SECRET,
    accessToken:  process.env.X_ACCESS_TOKEN,
    accessSecret: process.env.X_ACCESS_TOKEN_SECRET,
  });

  console.log('[backfill] Buscando ID da conta...');
  const me = await client.v2.me();
  console.log(`[backfill] Conta: @${me.data.username} (${me.data.id})`);

  console.log(`[backfill] Buscando últimos ${maxResults} tweets...`);
  const timeline = await client.v2.userTimeline(me.data.id, {
    max_results: Math.min(maxResults, 100),
    'tweet.fields': ['created_at', 'id'],
    exclude: ['retweets', 'replies'],
  });

  const tweets = timeline.data?.data || [];
  console.log(`[backfill] ${tweets.length} tweets encontrados.`);

  if (tweets.length === 0) {
    console.log('[backfill] Nenhum tweet para processar.');
    return;
  }

  // Monta índice de quotes por texto normalizado para match rápido
  const quotesData = JSON.parse(fs.readFileSync(QUOTES_FILE, 'utf8'));
  const quoteIndex = new Map(
    quotesData.quotes.map(q => [q.quote.toLowerCase().trim(), q])
  );

  const state   = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  const postedTweetIds = new Set(state.posted.map(p => p.tweetId));

  let added = 0;
  let skipped = 0;
  let unmatched = 0;

  for (const tweet of tweets) {
    if (postedTweetIds.has(tweet.id)) {
      skipped++;
      continue;
    }

    const tweetText = tweet.text.trim();
    const quote     = quoteIndex.get(tweetText);

    if (!quote) {
      // Tweet manual ou não-quote — ignora silenciosamente
      unmatched++;
      continue;
    }

    // Já tem esse quote no state (mesmo sem o tweetId)?
    if (state.posted.some(p => p.id === quote.id)) {
      console.log(`[backfill] → Quote #${quote.id} já no state (tweet ID diferente).`);
      skipped++;
      continue;
    }

    const entry = {
      id:       quote.id,
      tweetId:  tweet.id,
      postedAt: tweet.created_at || new Date().toISOString(),
    };

    console.log(`[backfill] + Quote #${quote.id} "${quote.quote.slice(0, 50)}…" → tweet ${tweet.id}`);

    if (!dryRun) state.posted.push(entry);
    added++;
  }

  console.log(`\n[backfill] Resultado: ${added} adicionados | ${skipped} já existiam | ${unmatched} sem match`);

  if (dryRun) {
    console.log('[backfill] Dry-run — state.json não foi alterado.');
    return;
  }

  if (added > 0) {
    // Ordena por data antes de salvar
    state.posted.sort((a, b) => new Date(a.postedAt) - new Date(b.postedAt));
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
    console.log('[backfill] state.json atualizado.');
  } else {
    console.log('[backfill] Nenhuma alteração necessária.');
  }
}

main().catch(err => {
  console.error('[backfill] Erro:', err.message);
  process.exit(1);
});
