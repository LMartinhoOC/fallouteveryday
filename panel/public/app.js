/* ── Estado ──────────────────────────────────────────────────────────────── */
let quotes              = [];
let activeGame          = 'all';
let searchQuery         = '';
let pendingDeleteQuoteId = null;
let editingQuoteId      = null;

/* ── Refs ────────────────────────────────────────────────────────────────── */
const $ = id => document.getElementById(id);

const loginScreen    = $('login-screen');
const mainScreen     = $('main-screen');
const loginForm      = $('login-form');
const loginError     = $('login-error');
const passwordInput  = $('password');

const themeBtn       = $('theme-btn');
const themeIcon      = $('theme-icon');
const logoutBtn      = $('logout-btn');
const todayBadge     = $('today-badge');

const dashSection    = $('dashboard-section');
const quotesSection  = $('quotes-section');

const statTotal      = $('stat-total');
const statPosted     = $('stat-posted');
const statRemaining  = $('stat-remaining');
const statYears      = $('stat-years');
const recentList     = $('recent-list');
const recentEmpty    = $('recent-empty');
const scheduleList   = $('schedule-list');

const quoteAddBtn        = $('quote-add-btn');
const quoteSearch        = $('quote-search');
const quotesList         = $('quotes-list');
const quotesEmptyState   = $('quotes-empty-state');
const quoteTotalBadge    = $('quote-total-badge');
const gameFiltersEl      = $('game-filters');

const modalBackdrop  = $('modal-backdrop');
const modalMsg       = $('modal-msg');
const modalCancel    = $('modal-cancel');
const modalConfirm   = $('modal-confirm');

const quoteModalBackdrop = $('quote-modal-backdrop');
const quoteForm          = $('quote-form');
const quoteModalTitle    = $('quote-modal-title');
const quoteIdInput       = $('quote-id-input');
const quoteTextInput     = $('quote-text-input');
const quoteCharacterInput= $('quote-character-input');
const quoteGameInput     = $('quote-game-input');
const quoteTagsInput     = $('quote-tags-input');
const quoteModalCancel   = $('quote-modal-cancel');
const quoteModalSubmit   = $('quote-modal-submit');

/* ── Tema ────────────────────────────────────────────────────────────────── */
function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  themeIcon.textContent = theme === 'dark' ? '☀' : '◑';
  localStorage.setItem('theme', theme);
}

const savedTheme = localStorage.getItem('theme') ||
  (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
applyTheme(savedTheme);

themeBtn.addEventListener('click', () => {
  applyTheme(document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark');
});

/* ── Tabs ────────────────────────────────────────────────────────────────── */
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    if (btn.dataset.tab === 'dashboard') {
      dashSection.classList.remove('hidden');
      quotesSection.classList.add('hidden');
      loadDashboard();
    } else {
      dashSection.classList.add('hidden');
      quotesSection.classList.remove('hidden');
      loadQuotes();
    }
  });
});

/* ── Auth ────────────────────────────────────────────────────────────────── */
async function checkAuth() {
  const res  = await fetch('/api/me');
  const data = await res.json();
  if (data.authenticated) showMain();
  else showLogin();
}

function showLogin() {
  loginScreen.classList.remove('hidden');
  mainScreen.classList.add('hidden');
  setTimeout(() => passwordInput.focus(), 50);
}

function showMain() {
  loginScreen.classList.add('hidden');
  mainScreen.classList.remove('hidden');
  loadDashboard({ sync: true });
}

loginForm.addEventListener('submit', async e => {
  e.preventDefault();
  loginError.classList.add('hidden');
  const btn = loginForm.querySelector('button[type="submit"]');
  btn.disabled = true;
  btn.textContent = 'Entrando…';
  try {
    const res = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: passwordInput.value }),
    });
    if (res.ok) {
      showMain();
    } else {
      const data = await res.json();
      loginError.textContent = data.error || 'Senha incorreta.';
      loginError.classList.remove('hidden');
      passwordInput.select();
    }
  } finally {
    btn.disabled = false;
    btn.textContent = 'Entrar';
  }
});

logoutBtn.addEventListener('click', async () => {
  await fetch('/api/logout', { method: 'POST' });
  passwordInput.value = '';
  showLogin();
});

/* ── Dashboard ───────────────────────────────────────────────────────────── */
async function loadDashboard({ sync = false } = {}) {
  setSyncState('loading');
  try {
    if (sync) {
      const syncRes = await fetch('/api/sync', { method: 'POST' });
      if (syncRes.status === 401) { showLogin(); return; }
      if (!syncRes.ok) {
        const err = await syncRes.json();
        setSyncState('error', err.error);
        // continue with local data anyway
      } else {
        const { syncedAt } = await syncRes.json();
        setSyncState('ok', syncedAt);
      }
    }

    const [statsRes, recentRes, scheduleRes] = await Promise.all([
      fetch('/api/stats'),
      fetch('/api/recent?limit=20'),
      fetch('/api/schedule'),
    ]);

    if (!statsRes.ok) { showLogin(); return; }

    const stats    = await statsRes.json();
    const recent   = await recentRes.json();
    const schedule = await scheduleRes.json();

    renderStats(stats);
    renderRecent(recent);
    renderSchedule(schedule);
    if (!sync) setSyncState('idle');
  } catch {
    setSyncState('error', 'Erro de rede');
  }
}

function setSyncState(state, detail = '') {
  const btn = $('sync-btn');
  const lbl = $('sync-label');
  if (!btn || !lbl) return;
  if (state === 'loading') {
    btn.disabled = true;
    lbl.textContent = 'Sincronizando…';
  } else if (state === 'ok') {
    btn.disabled = false;
    const time = detail ? new Date(detail).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '';
    lbl.textContent = time ? `Sincronizado às ${time}` : 'Sincronizado';
  } else if (state === 'error') {
    btn.disabled = false;
    lbl.textContent = detail || 'Erro ao sincronizar';
  } else {
    btn.disabled = false;
    lbl.textContent = '';
  }
}

function renderStats(stats) {
  statTotal.textContent     = stats.total.toLocaleString('pt-BR');
  statPosted.textContent    = stats.posted.toLocaleString('pt-BR');
  statRemaining.textContent = stats.remaining.toLocaleString('pt-BR');
  statYears.textContent     = stats.yearsLeft ? `${stats.yearsLeft} anos` : '—';
  todayBadge.textContent    = `${stats.todayCount} hoje`;
}

function renderRecent(posts) {
  recentList.innerHTML = '';
  if (!posts.length) {
    recentEmpty.classList.remove('hidden');
    return;
  }
  recentEmpty.classList.add('hidden');

  posts.forEach(p => {
    const item = document.createElement('div');
    item.className = 'recent-item';

    const tweetUrl = `https://x.com/i/web/status/${p.tweetId}`;
    const isMock   = String(p.tweetId).startsWith('MOCK_');

    item.innerHTML = `
      <div class="recent-item-body">
        <div class="recent-quote">${escapeHtml(p.quote)}</div>
        <div class="recent-meta">
          <span class="quote-character">${escapeHtml(p.character)}</span>
          <span class="quote-game">${escapeHtml(p.game)}</span>
          <span class="recent-time">${timeAgo(p.postedAt)}</span>
          ${!isMock ? `<a class="recent-link" href="${tweetUrl}" target="_blank" rel="noopener">Ver tweet →</a>` : ''}
        </div>
      </div>
    `;
    recentList.appendChild(item);
  });
}

function renderSchedule(slots) {
  scheduleList.innerHTML = '';
  if (!slots.length) {
    scheduleList.textContent = 'Nenhum schedule encontrado.';
    return;
  }

  const nextIdx = slots.findIndex(s => !s.passed);

  slots.forEach((slot, i) => {
    const item = document.createElement('div');
    item.className = 'schedule-slot' + (slot.passed ? ' slot-passed' : '') + (i === nextIdx ? ' slot-next' : '');
    item.innerHTML = `
      <span class="slot-brt">${slot.brt}</span>
      <span class="slot-utc">UTC ${slot.utc}</span>
      ${i === nextIdx ? '<span class="slot-badge">próximo</span>' : ''}
    `;
    scheduleList.appendChild(item);
  });
}

/* ── Quotes: carregar e renderizar ──────────────────────────────────────── */
async function loadQuotes() {
  try {
    const params = new URLSearchParams();
    if (activeGame !== 'all') params.set('game', activeGame);
    if (searchQuery) params.set('q', searchQuery);

    const res  = await fetch(`/api/quotes?${params}`);
    if (!res.ok) { showLogin(); return; }
    const data = await res.json();
    quotes = data.quotes || [];
    renderGameFilters(data._meta);
    renderQuotes();
  } catch {
    // silently fail
  }
}

function renderGameFilters(meta) {
  quoteTotalBadge.textContent = `${quotes.length} quote${quotes.length !== 1 ? 's' : ''}`;

  gameFiltersEl.innerHTML = '';

  const allBtn = document.createElement('button');
  allBtn.className = `filter${activeGame === 'all' ? ' active' : ''}`;
  allBtn.dataset.game = 'all';
  allBtn.textContent = 'Todos';
  gameFiltersEl.appendChild(allBtn);

  const gamesInData = [...new Set(quotes.map(q => {
    if (q.game.startsWith('Fallout: New Vegas')) return 'Fallout: New Vegas';
    return q.game;
  }))].sort();

  gamesInData.forEach(game => {
    const btn = document.createElement('button');
    btn.className = `filter${activeGame === game ? ' active' : ''}`;
    btn.dataset.game = game;
    btn.textContent = game
      .replace('Fallout: New Vegas', 'New Vegas')
      .replace('Fallout TV Series (2024)', 'TV Series');
    gameFiltersEl.appendChild(btn);
  });

  gameFiltersEl.querySelectorAll('.filter').forEach(btn => {
    btn.addEventListener('click', () => {
      gameFiltersEl.querySelectorAll('.filter').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      activeGame = btn.dataset.game;
      loadQuotes();
    });
  });
}

function renderQuotes() {
  quotesList.innerHTML = '';

  let filtered = quotes;
  if (activeGame !== 'all') {
    filtered = quotes.filter(q => q.game === activeGame || q.game.startsWith(activeGame));
  }

  quoteTotalBadge.textContent = `${filtered.length} quote${filtered.length !== 1 ? 's' : ''}`;

  if (filtered.length === 0) {
    quotesEmptyState.classList.remove('hidden');
    return;
  }
  quotesEmptyState.classList.add('hidden');

  filtered.forEach(qt => {
    const item = document.createElement('div');
    item.className = 'quote-item';

    const tagsHtml = (qt.tags || []).map(t =>
      `<span class="tag-pill">${escapeHtml(t)}</span>`
    ).join('');

    item.innerHTML = `
      <div class="quote-item-body">
        <div class="quote-text">"${escapeHtml(qt.quote)}"</div>
        <div class="quote-meta">
          <span class="quote-character">${escapeHtml(qt.character)}</span>
          <span class="quote-game">${escapeHtml(qt.game)}</span>
          ${tagsHtml ? `<div class="quote-tags">${tagsHtml}</div>` : ''}
        </div>
      </div>
      <div class="quote-item-actions">
        <button class="btn-edit"   data-id="${qt.id}">Editar</button>
        <button class="btn-delete" data-id="${qt.id}">Excluir</button>
      </div>
    `;
    quotesList.appendChild(item);
  });

  quotesList.querySelectorAll('.btn-edit').forEach(btn => {
    btn.addEventListener('click', () => openQuoteModal(parseInt(btn.dataset.id, 10)));
  });
  quotesList.querySelectorAll('.btn-delete').forEach(btn => {
    btn.addEventListener('click', () => confirmDeleteQuote(parseInt(btn.dataset.id, 10)));
  });
}

/* ── Quotes: busca ───────────────────────────────────────────────────────── */
let searchTimeout = null;
quoteSearch.addEventListener('input', () => {
  clearTimeout(searchTimeout);
  searchTimeout = setTimeout(() => {
    searchQuery = quoteSearch.value.trim();
    loadQuotes();
  }, 300);
});

/* ── Quotes: modal criar/editar ──────────────────────────────────────────── */
quoteAddBtn.addEventListener('click', () => openQuoteModal(null));

function openQuoteModal(id) {
  editingQuoteId = id;
  quoteForm.reset();

  if (id !== null) {
    const qt = quotes.find(q => q.id === id);
    if (!qt) return;
    quoteModalTitle.textContent    = 'Editar Quote';
    quoteModalSubmit.textContent   = 'Salvar';
    quoteIdInput.value             = qt.id;
    quoteTextInput.value           = qt.quote;
    quoteCharacterInput.value      = qt.character;
    quoteGameInput.value           = qt.game;
    quoteTagsInput.value           = (qt.tags || []).join(', ');
  } else {
    quoteModalTitle.textContent  = 'Nova Quote';
    quoteModalSubmit.textContent = 'Criar';
    quoteIdInput.value           = '';
  }

  quoteModalBackdrop.classList.remove('hidden');
  setTimeout(() => quoteTextInput.focus(), 50);
}

function closeQuoteModal() {
  quoteModalBackdrop.classList.add('hidden');
  editingQuoteId = null;
}

quoteModalCancel.addEventListener('click', closeQuoteModal);
quoteModalBackdrop.addEventListener('click', e => {
  if (e.target === quoteModalBackdrop) closeQuoteModal();
});

quoteForm.addEventListener('submit', async e => {
  e.preventDefault();
  const btn = quoteModalSubmit;
  btn.disabled = true;
  btn.textContent = 'Salvando…';

  const body = {
    quote:     quoteTextInput.value.trim(),
    character: quoteCharacterInput.value.trim(),
    game:      quoteGameInput.value,
    tags:      quoteTagsInput.value.trim(),
  };

  try {
    let res;
    if (editingQuoteId !== null) {
      res = await fetch(`/api/quotes/${editingQuoteId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
    } else {
      res = await fetch('/api/quotes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
    }
    const data = await res.json();
    if (res.ok) {
      closeQuoteModal();
      await loadQuotes();
    } else {
      alert(data.error || 'Erro ao salvar quote.');
    }
  } finally {
    btn.disabled = false;
    btn.textContent = editingQuoteId !== null ? 'Salvar' : 'Criar';
  }
});

/* ── Quotes: delete ──────────────────────────────────────────────────────── */
function confirmDeleteQuote(id) {
  const qt = quotes.find(q => q.id === id);
  if (!qt) return;
  pendingDeleteQuoteId = id;
  modalMsg.textContent = `Excluir a quote de ${qt.character}?`;
  modalBackdrop.classList.remove('hidden');
}

modalCancel.addEventListener('click', () => {
  modalBackdrop.classList.add('hidden');
  pendingDeleteQuoteId = null;
});

modalBackdrop.addEventListener('click', e => {
  if (e.target === modalBackdrop) {
    modalBackdrop.classList.add('hidden');
    pendingDeleteQuoteId = null;
  }
});

modalConfirm.addEventListener('click', async () => {
  modalBackdrop.classList.add('hidden');
  if (pendingDeleteQuoteId !== null) {
    const res = await fetch(`/api/quotes/${pendingDeleteQuoteId}`, { method: 'DELETE' });
    pendingDeleteQuoteId = null;
    if (res.ok) await loadQuotes();
    else alert('Erro ao excluir quote.');
  }
});

/* ── Helpers ─────────────────────────────────────────────────────────────── */
function timeAgo(isoStr) {
  const diff = Date.now() - new Date(isoStr).getTime();
  const mins  = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days  = Math.floor(diff / 86400000);
  if (mins  <  1) return 'agora';
  if (mins  < 60) return `${mins}min atrás`;
  if (hours < 24) return `${hours}h atrás`;
  if (days  <  7) return `${days}d atrás`;
  return new Date(isoStr).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/* ── Sync button ─────────────────────────────────────────────────────────── */
$('sync-btn').addEventListener('click', () => loadDashboard({ sync: true }));

/* ── Init ────────────────────────────────────────────────────────────────── */
checkAuth();
