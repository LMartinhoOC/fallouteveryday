require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const fs   = require('fs');
const path = require('path');

const QUOTES_FILE = path.join(__dirname, '../data/quotes.json');
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

async function postNext() {
  const data   = JSON.parse(fs.readFileSync(QUOTES_FILE, 'utf8'));
  const quotes = data.quotes;

  const unposted = quotes.filter(q => !q.lastPostedAt);
  const pool     = unposted.length > 0 ? unposted : quotes;

  const entry = pool[Math.floor(Math.random() * pool.length)];
  const tweet = entry.quote.toLowerCase();

  console.log(`[bot] ${MOCK_MODE ? '[MOCK] ' : ''}Postando "${tweet.slice(0, 60).replace(/\n/g, ' ')}…"`);

  try {
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

    const idx = quotes.findIndex(q => q.id === entry.id);
    quotes[idx].lastPostedAt = new Date().toISOString();
    quotes[idx].tweetId      = tweetId;
    fs.writeFileSync(QUOTES_FILE, JSON.stringify(data, null, 2));

    return tweetId;
  } catch (err) {
    console.error('[bot] Erro ao postar:', err.message);
    throw err;
  }
}

module.exports = { postNext };

if (require.main === module) {
  postNext().catch(console.error);
}
