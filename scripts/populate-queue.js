#!/usr/bin/env node
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const fs   = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const QUOTES_FILE     = path.join(__dirname, '../data/quotes.json');
const QUEUE_FILE      = path.join(__dirname, '../data/scheduled.json');
const MAX_TWEET_CHARS = 280;

function formatCaption(quote) {
  return `"${quote.quote}" — ${quote.character}, ${quote.game}\n\n#Fallout #FalloutQuotes`;
}

function nextDayAfterQueue(queue) {
  const tomorrow = new Date();
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  tomorrow.setUTCHours(0, 0, 0, 0);

  const pending = queue.filter(p => p.status === 'pending');
  if (pending.length === 0) return tomorrow;

  const latest = pending.reduce((max, p) => {
    const d = new Date(p.scheduledAt);
    return d > max ? d : max;
  }, new Date(0));

  const next = new Date(latest);
  next.setUTCDate(next.getUTCDate() + 1);
  next.setUTCHours(0, 0, 0, 0);

  // Nunca agenda no passado — usa amanhã como piso
  return next > tomorrow ? next : tomorrow;
}

function main() {
  const quotesData = JSON.parse(fs.readFileSync(QUOTES_FILE, 'utf8'));
  const queueData  = JSON.parse(fs.readFileSync(QUEUE_FILE,  'utf8'));

  // IDs de quotes já presentes na fila (qualquer status)
  const alreadyQueued = new Set(
    queueData.queue
      .filter(p => p.quoteId != null)
      .map(p => p.quoteId)
  );

  const toSchedule = quotesData.quotes.filter(q => !alreadyQueued.has(q.id));

  if (toSchedule.length === 0) {
    console.log('[populate] Todas as quotes já estão na fila. Nada a fazer.');
    return;
  }

  console.log(`[populate] ${toSchedule.length} quotes para adicionar à fila.`);

  const firstDate = nextDayAfterQueue(queueData.queue);
  let currentDate = new Date(firstDate);
  let warned = 0;

  for (const quote of toSchedule) {
    const caption = formatCaption(quote);

    if (caption.length > MAX_TWEET_CHARS) {
      console.warn(`[populate] ⚠  Quote ID ${quote.id} excede ${MAX_TWEET_CHARS} chars (${caption.length}): "${quote.quote.slice(0, 50)}…"`);
      warned++;
    }

    queueData.queue.push({
      id:          uuidv4(),
      quoteId:     quote.id,
      caption:     caption,
      scheduledAt: currentDate.toISOString(),
      imagePath:   null,
      status:      'pending',
      createdAt:   new Date().toISOString(),
    });

    currentDate = new Date(currentDate);
    currentDate.setUTCDate(currentDate.getUTCDate() + 1);
  }

  // currentDate aponta para o dia seguinte ao último agendado
  const lastDate = new Date(currentDate);
  lastDate.setUTCDate(lastDate.getUTCDate() - 1);

  fs.writeFileSync(QUEUE_FILE, JSON.stringify(queueData, null, 2));

  console.log(`[populate] Adicionadas ${toSchedule.length} quotes.`);
  console.log(`[populate] Primeira: ${firstDate.toISOString().split('T')[0]}`);
  console.log(`[populate] Ultima:   ${lastDate.toISOString().split('T')[0]}`);
  if (warned > 0) {
    console.log(`[populate] ⚠  ${warned} quote(s) excedem 280 chars — revise antes de publicar.`);
  }
}

main();
