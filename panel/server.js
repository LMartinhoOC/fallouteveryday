require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const express  = require('express');
const session  = require('express-session');
const path     = require('path');
const fs       = require('fs');
const bcrypt   = require('bcryptjs');

const app           = express();
const PORT          = process.env.PORT || 3000;
const STATE_FILE    = path.join(__dirname, '../data/state.json');
const QUOTES_FILE   = path.join(__dirname, '../data/quotes.json');
const WORKFLOW_FILE = path.join(__dirname, '../.github/workflows/post.yml');
const STATE_RAW_URL = 'https://raw.githubusercontent.com/LMartinhoOC/fallouteveryday/main/data/state.json';

// ─── Middleware ─────────────────────────────────────────────────────────────
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(session({
  secret: process.env.SESSION_SECRET || 'dev-secret-change-me',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 8 * 60 * 60 * 1000 },
}));

app.use(express.static(path.join(__dirname, 'public')));

// ─── Helpers ───────────────────────────────────────────────────────────────
function readState()  { return JSON.parse(fs.readFileSync(STATE_FILE,  'utf8')); }
function readQuotes() { return JSON.parse(fs.readFileSync(QUOTES_FILE, 'utf8')); }
function writeQuotes(data) { fs.writeFileSync(QUOTES_FILE, JSON.stringify(data, null, 2)); }

function requireAuth(req, res, next) {
  if (req.session.authenticated) return next();
  res.status(401).json({ error: 'Não autenticado.' });
}

// ─── Auth ──────────────────────────────────────────────────────────────────
app.get('/api/me', (req, res) => {
  res.json({ authenticated: !!req.session.authenticated });
});

app.post('/api/login', async (req, res) => {
  const { password } = req.body;
  if (!process.env.PANEL_PASSWORD) {
    return res.status(500).json({ error: 'PANEL_PASSWORD não configurada no .env' });
  }
  const stored = process.env.PANEL_PASSWORD;
  let match;
  if (stored.startsWith('$2')) {
    match = await bcrypt.compare(password, stored);
  } else {
    console.warn('[painel] ⚠  PANEL_PASSWORD em texto puro. Gere um hash com:\n  node -e "require(\'bcryptjs\').hash(\'SUA_SENHA\', 10).then(console.log)"');
    match = password === stored;
  }
  if (match) {
    req.session.authenticated = true;
    return res.json({ ok: true });
  }
  res.status(401).json({ error: 'Senha incorreta.' });
});

app.post('/api/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

// ─── Sync (busca state.json do GitHub e salva localmente) ──────────────────
app.post('/api/sync', requireAuth, async (req, res) => {
  try {
    const response = await fetch(STATE_RAW_URL, { cache: 'no-store' });
    if (!response.ok) throw new Error(`GitHub retornou ${response.status}`);
    const text = await response.text();
    JSON.parse(text); // valida JSON antes de salvar
    fs.writeFileSync(STATE_FILE, text);
    res.json({ ok: true, syncedAt: new Date().toISOString() });
  } catch (err) {
    res.status(502).json({ error: `Falha ao sincronizar: ${err.message}` });
  }
});

// ─── Stats ─────────────────────────────────────────────────────────────────
app.get('/api/stats', requireAuth, (req, res) => {
  const state  = readState();
  const quotes = readQuotes();

  const total  = quotes.quotes.length;
  const posted = state.posted.length;

  const today      = new Date().toISOString().slice(0, 10);
  const todayCount = state.posted.filter(p => p.postedAt.startsWith(today)).length;

  const lastPost = state.posted.length > 0
    ? state.posted[state.posted.length - 1]
    : null;

  let postsPerDay = 15;
  try {
    const yml  = fs.readFileSync(WORKFLOW_FILE, 'utf8');
    postsPerDay = (yml.match(/- cron:/g) || []).length || 15;
  } catch {}

  const remaining = total - posted;
  const daysLeft  = postsPerDay > 0 ? Math.ceil(remaining / postsPerDay) : null;
  const yearsLeft = daysLeft ? (daysLeft / 365).toFixed(1) : null;

  res.json({ total, posted, remaining, todayCount, lastPostedAt: lastPost?.postedAt || null, yearsLeft, postsPerDay });
});

// ─── Recent posts ───────────────────────────────────────────────────────────
app.get('/api/recent', requireAuth, (req, res) => {
  const limit  = Math.min(parseInt(req.query.limit) || 20, 50);
  const state  = readState();
  const quotes = readQuotes();

  const quoteMap = new Map(quotes.quotes.map(q => [q.id, q]));

  const recent = [...state.posted]
    .reverse()
    .slice(0, limit)
    .map(p => {
      const q = quoteMap.get(p.id);
      return {
        id:        p.id,
        tweetId:   p.tweetId,
        postedAt:  p.postedAt,
        quote:     q?.quote     || '(quote não encontrada)',
        character: q?.character || '?',
        game:      q?.game      || '?',
        tags:      q?.tags      || [],
      };
    });

  res.json(recent);
});

// ─── Schedule (parsed from post.yml) ───────────────────────────────────────
app.get('/api/schedule', requireAuth, (req, res) => {
  try {
    const yml  = fs.readFileSync(WORKFLOW_FILE, 'utf8');
    const matches = [...yml.matchAll(/- cron:\s*['"]([^'"]+)['"]/g)];
    const now  = new Date();

    const slots = matches.map(m => {
      const expr   = m[1];
      const parts  = expr.split(' ');
      const utcMin = parseInt(parts[0], 10);
      const utcHour= parseInt(parts[1], 10);

      // BRT = UTC-3 (Brasil não usa horário de verão desde 2019)
      let brtHour = utcHour - 3;
      if (brtHour < 0) brtHour += 24;

      const utcStr = `${String(utcHour).padStart(2,'0')}:${String(utcMin).padStart(2,'0')}`;
      const brtStr = `${String(brtHour).padStart(2,'0')}:${String(utcMin).padStart(2,'0')}`;

      const todayDate  = now.toISOString().slice(0, 10);
      const slotUtcMs  = new Date(`${todayDate}T${utcStr}:00Z`).getTime();
      const passed     = slotUtcMs <= now.getTime();

      return { cron: expr, utc: utcStr, brt: brtStr, passed };
    });

    res.json(slots);
  } catch (err) {
    res.status(500).json({ error: 'Não foi possível ler o workflow.' });
  }
});

// ─── Quotes CRUD ───────────────────────────────────────────────────────────
app.get('/api/quotes', requireAuth, (req, res) => {
  const data   = readQuotes();
  let   quotes = data.quotes;
  const { q, game } = req.query;
  if (game) quotes = quotes.filter(qt => qt.game === game);
  if (q) {
    const lower = q.toLowerCase();
    quotes = quotes.filter(qt =>
      qt.quote.toLowerCase().includes(lower) ||
      qt.character.toLowerCase().includes(lower)
    );
  }
  res.json({ quotes, _meta: data._meta });
});

app.post('/api/quotes', requireAuth, (req, res) => {
  const { quote, character, game, tags } = req.body;
  if (!quote?.trim() || !character?.trim() || !game?.trim()) {
    return res.status(400).json({ error: 'quote, character e game são obrigatórios.' });
  }
  const data  = readQuotes();
  const maxId = data.quotes.reduce((m, qt) => Math.max(m, qt.id), 0);
  const entry = {
    id: maxId + 1,
    quote: quote.trim(),
    character: character.trim(),
    game: game.trim(),
    tags: tags ? String(tags).split(',').map(t => t.trim()).filter(Boolean) : [],
  };
  data.quotes.push(entry);
  data._meta.total = data.quotes.length;
  writeQuotes(data);
  res.status(201).json({ ok: true, quote: entry });
});

app.put('/api/quotes/:id', requireAuth, (req, res) => {
  const id = parseInt(req.params.id, 10);
  const { quote, character, game, tags } = req.body;
  if (!quote?.trim() || !character?.trim() || !game?.trim()) {
    return res.status(400).json({ error: 'quote, character e game são obrigatórios.' });
  }
  const data = readQuotes();
  const idx  = data.quotes.findIndex(qt => qt.id === id);
  if (idx === -1) return res.status(404).json({ error: 'Quote não encontrada.' });
  data.quotes[idx] = {
    ...data.quotes[idx],
    quote: quote.trim(),
    character: character.trim(),
    game: game.trim(),
    tags: tags ? String(tags).split(',').map(t => t.trim()).filter(Boolean) : [],
  };
  writeQuotes(data);
  res.json({ ok: true, quote: data.quotes[idx] });
});

app.delete('/api/quotes/:id', requireAuth, (req, res) => {
  const id  = parseInt(req.params.id, 10);
  const data = readQuotes();
  const idx  = data.quotes.findIndex(qt => qt.id === id);
  if (idx === -1) return res.status(404).json({ error: 'Quote não encontrada.' });
  data.quotes.splice(idx, 1);
  data._meta.total = data.quotes.length;
  writeQuotes(data);
  res.json({ ok: true });
});

// ─── Start ─────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`[painel] Rodando em http://localhost:${PORT}`);
});
