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

function formatTweet(entry) {
  return entry.quote;
}

async function postNext() {
  const data = JSON.parse(fs.readFileSync(QUOTES_FILE, 'utf8'));

  // Pick the quote with the oldest lastPostedAt (null counts as never posted, so it goes first)
  const sorted = [...data.quotes].sort((a, b) => {
    if (a.lastPostedAt === null) return -1;
    if (b.lastPostedAt === null) return 1;
    return new Date(a.lastPostedAt) - new Date(b.lastPostedAt);
  });

  const entry = sorted[0];
  const tweet = formatTweet(entry);

  console.log(`[bot] ${MOCK_MODE ? '[MOCK] ' : ''}Postando ID ${entry.id}: "${entry.quote.slice(0, 60)}…"`);

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

    const idx = data.quotes.findIndex(q => q.id === entry.id);
    data.quotes[idx].lastPostedAt = new Date().toISOString();
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
