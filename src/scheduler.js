require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const cron = require('node-cron');
const { postNext } = require('./bot');

const schedule = process.env.CRON_SCHEDULE || '0 * * * *';

cron.schedule(schedule, async () => {
  console.log(`[scheduler] ${new Date().toISOString()} — Disparando bot...`);
  try {
    await postNext();
  } catch (err) {
    console.error('[scheduler] Erro no bot:', err.message);
  }
});

console.log(`[scheduler] Iniciado. Schedule: ${schedule}`);
