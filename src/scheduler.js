require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const cron = require('node-cron');
const { postNext } = require('./bot');

// Dispara todo dia às 9h em ponto e calcula um delay aleatório até meio-dia (3h = 180min)
cron.schedule('0 9 * * *', async () => {
  const delayMinutes = Math.floor(Math.random() * 181); // 0 a 180 minutos
  const hours   = Math.floor(delayMinutes / 60);
  const minutes = delayMinutes % 60;
  const postAt  = new Date(Date.now() + delayMinutes * 60 * 1000);

  console.log(`[scheduler] ${new Date().toISOString()} — Post agendado para daqui ${hours}h${String(minutes).padStart(2, '0')}min (${postAt.toISOString()})`);

  setTimeout(async () => {
    console.log(`[scheduler] ${new Date().toISOString()} — Disparando bot...`);
    try {
      await postNext();
    } catch (err) {
      console.error('[scheduler] Erro no bot:', err.message);
    }
  }, delayMinutes * 60 * 1000);
});

console.log('[scheduler] Iniciado. Posts diários entre 9h e 12h (horário do servidor).');
