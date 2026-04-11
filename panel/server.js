require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const express  = require('express');
const session  = require('express-session');
const multer   = require('multer');
const path     = require('path');
const fs       = require('fs');
const { v4: uuidv4 } = require('uuid');

const app         = express();
const PORT        = process.env.PORT || 3000;
const QUEUE_FILE  = path.join(__dirname, '../data/scheduled.json');
const QUOTES_FILE = path.join(__dirname, '../data/quotes.json');
const UPLOADS     = path.join(__dirname, '../uploads');

// ─── Multer ────────────────────────────────────────────────────────────────
const storage = multer.diskStorage({
  destination: UPLOADS,
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `${uuidv4()}${ext}`);
  },
});
const upload = multer({
  storage,
  limits: { fileSize: 15 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (/^image\//.test(file.mimetype)) cb(null, true);
    else cb(new Error('Apenas imagens são aceitas.'));
  },
});

// ─── Middleware ─────────────────────────────────────────────────────────────
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(session({
  secret: process.env.SESSION_SECRET || 'dev-secret-change-me',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 8 * 60 * 60 * 1000 }, // 8 horas
}));

app.use('/uploads', express.static(UPLOADS));
app.use(express.static(path.join(__dirname, 'public')));

// ─── Helpers ───────────────────────────────────────────────────────────────
function readQueue() {
  return JSON.parse(fs.readFileSync(QUEUE_FILE, 'utf8'));
}
function writeQueue(data) {
  fs.writeFileSync(QUEUE_FILE, JSON.stringify(data, null, 2));
}
function requireAuth(req, res, next) {
  if (req.session.authenticated) return next();
  res.status(401).json({ error: 'Não autenticado.' });
}

function readQuotes() {
  return JSON.parse(fs.readFileSync(QUOTES_FILE, 'utf8'));
}
function writeQuotes(data) {
  fs.writeFileSync(QUOTES_FILE, JSON.stringify(data, null, 2));
}

// ─── Auth ──────────────────────────────────────────────────────────────────
app.get('/api/me', (req, res) => {
  res.json({ authenticated: !!req.session.authenticated });
});

app.post('/api/login', (req, res) => {
  const { password } = req.body;
  if (!process.env.PANEL_PASSWORD) {
    return res.status(500).json({ error: 'PANEL_PASSWORD não configurada no .env' });
  }
  if (password === process.env.PANEL_PASSWORD) {
    req.session.authenticated = true;
    return res.json({ ok: true });
  }
  res.status(401).json({ error: 'Senha incorreta.' });
});

app.post('/api/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

// ─── Queue ─────────────────────────────────────────────────────────────────
app.get('/api/queue', requireAuth, (req, res) => {
  res.json(readQueue());
});

app.post('/api/queue', requireAuth, upload.single('image'), (req, res) => {
  const { caption, scheduledAt } = req.body;
  if (!caption?.trim()) {
    if (req.file) fs.unlinkSync(req.file.path);
    return res.status(400).json({ error: 'Legenda obrigatória.' });
  }
  if (!scheduledAt) {
    if (req.file) fs.unlinkSync(req.file.path);
    return res.status(400).json({ error: 'Data/hora obrigatória.' });
  }

  const data = readQueue();
  const post = {
    id:          uuidv4(),
    caption:     caption.trim(),
    scheduledAt: new Date(scheduledAt).toISOString(),
    imagePath:   req.file ? req.file.filename : null,
    status:      'pending',
    createdAt:   new Date().toISOString(),
  };
  data.queue.push(post);
  writeQueue(data);
  res.status(201).json({ ok: true, post });
});

app.delete('/api/queue/:id', requireAuth, (req, res) => {
  const data = readQueue();
  const idx  = data.queue.findIndex(p => p.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Post não encontrado.' });

  const post = data.queue[idx];
  if (post.imagePath) {
    const imgPath = path.join(UPLOADS, post.imagePath);
    if (fs.existsSync(imgPath)) fs.unlinkSync(imgPath);
  }
  data.queue.splice(idx, 1);
  writeQueue(data);
  res.json({ ok: true });
});

// ─── Quotes CRUD ───────────────────────────────────────────────────────────
app.get('/api/quotes', requireAuth, (req, res) => {
  const data = readQuotes();
  let quotes = data.quotes;
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
  const data = readQuotes();
  const maxId = data.quotes.reduce((m, qt) => Math.max(m, qt.id), 0);
  const entry = {
    id: maxId + 1,
    quote: quote.trim(),
    character: character.trim(),
    game: game.trim(),
    tags: tags ? String(tags).split(',').map(t => t.trim()).filter(Boolean) : [],
    lastPostedAt: null,
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
  const idx = data.quotes.findIndex(qt => qt.id === id);
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
  const id = parseInt(req.params.id, 10);
  const data = readQuotes();
  const idx = data.quotes.findIndex(qt => qt.id === id);
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
