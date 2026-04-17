/* ── Estado ──────────────────────────────────────────────────────────────── */
let queue           = [];
let activeFilter    = 'all';
let pendingDeleteId = null;

let quotes          = [];
let activeGame      = 'all';
let searchQuery     = '';
let pendingDeleteQuoteId = null;
let pendingScheduleQuote = null;
let editingQuoteId  = null;

/* ── Refs ────────────────────────────────────────────────────────────────── */
const $ = id => document.getElementById(id);

const loginScreen   = $('login-screen');
const mainScreen    = $('main-screen');
const loginForm     = $('login-form');
const loginError    = $('login-error');
const passwordInput = $('password');

const addBtn        = $('add-btn');
const addForm       = $('add-form');
const postForm      = $('post-form');
const cancelBtn     = $('cancel-btn');
const emptyAddBtn   = $('empty-add-btn');

const uploadZone    = $('upload-zone');
const imageInput    = $('image-input');
const placeholder   = $('upload-placeholder');
const imgPreview    = $('img-preview');
const removeImgBtn  = $('remove-img');

const captionInput  = $('caption-input');
const charCount     = $('char-count');
const scheduleInput = $('schedule-input');

const queueList     = $('queue-list');
const emptyState    = $('empty-state');
const pendingBadge  = $('pending-badge');

const themeBtn      = $('theme-btn');
const themeIcon     = $('theme-icon');
const logoutBtn     = $('logout-btn');

const modalBackdrop = $('modal-backdrop');
const modalMsg      = $('modal-msg');
const modalCancel   = $('modal-cancel');
const modalConfirm  = $('modal-confirm');

// Quotes refs
const quoteSection       = $('quotes-section');
const queueSection       = $('queue-section');
const quoteAddBtn        = $('quote-add-btn');
const quoteSearch        = $('quote-search');
const quotesList         = $('quotes-list');
const quotesEmptyState   = $('quotes-empty-state');
const quoteTotalBadge    = $('quote-total-badge');
const gameFiltersEl      = $('game-filters');

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

const scheduleModalBackdrop = $('schedule-modal-backdrop');
const schedulePreview       = $('schedule-preview');
const scheduleModalInput    = $('schedule-modal-input');
const scheduleModalCancel   = $('schedule-modal-cancel');
const scheduleModalConfirm  = $('schedule-modal-confirm');

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
  const current = document.documentElement.getAttribute('data-theme');
  applyTheme(current === 'dark' ? 'light' : 'dark');
});

/* ── Tabs ────────────────────────────────────────────────────────────────── */
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    const tab = btn.dataset.tab;
    if (tab === 'queue') {
      queueSection.classList.remove('hidden');
      quoteSection.classList.add('hidden');
    } else {
      queueSection.classList.add('hidden');
      quoteSection.classList.remove('hidden');
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
  loadQueue();
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

/* ── Fila ────────────────────────────────────────────────────────────────── */
async function loadQueue() {
  try {
    const res  = await fetch('/api/queue');
    if (!res.ok) { showLogin(); return; }
    const data = await res.json();
    queue = (data.queue || []).sort((a, b) => new Date(a.scheduledAt) - new Date(b.scheduledAt));
    renderQueue();
  } catch {
    // silently fail
  }
}

function renderQueue() {
  const counts = { all: queue.length, pending: 0, posted: 0, error: 0 };
  queue.forEach(p => { if (counts[p.status] !== undefined) counts[p.status]++; });

  $('count-all').textContent     = counts.all;
  $('count-pending').textContent = counts.pending;
  $('count-posted').textContent  = counts.posted;
  $('count-error').textContent   = counts.error;

  const n = counts.pending;
  pendingBadge.textContent = `${n} pendente${n !== 1 ? 's' : ''}`;

  const filtered = activeFilter === 'all' ? queue : queue.filter(p => p.status === activeFilter);

  queueList.innerHTML = '';

  if (filtered.length === 0) {
    emptyState.classList.remove('hidden');
    return;
  }
  emptyState.classList.add('hidden');

  filtered.forEach(post => {
    const item = document.createElement('div');
    item.className = 'queue-item';
    item.dataset.id = post.id;

    const thumb = post.imagePath
      ? `<img class="item-thumb" src="/uploads/${post.imagePath}" alt="" loading="lazy" />`
      : `<div class="item-thumb-placeholder">☢</div>`;

    const statusMap = {
      pending: ['status-pending', 'Pendente'],
      posted:  ['status-posted',  'Postado'],
      error:   ['status-error',   'Erro'],
    };
    const [cls, label] = statusMap[post.status] || ['status-pending', post.status];

    const scheduledStr = new Date(post.scheduledAt).toLocaleString('pt-BR', {
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });

    const extraMeta = post.status === 'error' && post.error
      ? `<span title="${post.error}">⚠ ${post.error.slice(0, 50)}</span>`
      : post.status === 'posted' && post.tweetId
        ? `<span>Tweet: <a href="https://x.com/i/web/status/${post.tweetId}" target="_blank" rel="noopener">${post.tweetId.slice(0, 12)}…</a></span>`
        : '';

    const canDelete = post.status !== 'posted';

    item.innerHTML = `
      ${thumb}
      <div class="item-body">
        <div class="item-caption">${escapeHtml(post.caption)}</div>
        <div class="item-meta">
          <span class="status-badge ${cls}">${label}</span>
          <span>📅 ${scheduledStr}</span>
          ${extraMeta}
        </div>
      </div>
      <div class="item-actions">
        ${canDelete ? `<button class="btn-delete" data-id="${post.id}">Excluir</button>` : ''}
      </div>
    `;
    queueList.appendChild(item);
  });

  queueList.querySelectorAll('.btn-delete').forEach(btn => {
    btn.addEventListener('click', () => confirmDelete(btn.dataset.id));
  });
}

/* ── Filtros (fila) ──────────────────────────────────────────────────────── */
document.querySelectorAll('.filter').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('#filters .filter').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    activeFilter = btn.dataset.filter;
    renderQueue();
  });
});

/* ── Formulário de adição (fila) ─────────────────────────────────────────── */
function openAddForm(caption = '') {
  addForm.classList.remove('hidden');
  addForm.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setMinutes(0, 0, 0);
  scheduleInput.value = toLocalDatetimeInput(d);
  if (caption) {
    captionInput.value = caption;
    charCount.textContent = caption.length;
  }
  captionInput.focus();
}

function closeAddForm() {
  addForm.classList.add('hidden');
  postForm.reset();
  clearImagePreview();
  charCount.textContent = '0';
}

addBtn.addEventListener('click', () => openAddForm());
emptyAddBtn.addEventListener('click', () => openAddForm());
cancelBtn.addEventListener('click', closeAddForm);

captionInput.addEventListener('input', () => {
  charCount.textContent = captionInput.value.length;
});

postForm.addEventListener('submit', async e => {
  e.preventDefault();
  const btn = postForm.querySelector('button[type="submit"]');
  btn.disabled = true;
  btn.textContent = 'Agendando…';

  try {
    const formData = new FormData(postForm);
    const res = await fetch('/api/queue', { method: 'POST', body: formData });
    const data = await res.json();

    if (res.ok) {
      closeAddForm();
      await loadQueue();
    } else {
      alert(data.error || 'Erro ao agendar post.');
    }
  } finally {
    btn.disabled = false;
    btn.textContent = 'Agendar';
  }
});

/* ── Upload ──────────────────────────────────────────────────────────────── */
imageInput.addEventListener('change', () => {
  if (imageInput.files[0]) showPreview(imageInput.files[0]);
});

uploadZone.addEventListener('dragover', e => {
  e.preventDefault();
  uploadZone.classList.add('drag-over');
});
uploadZone.addEventListener('dragleave', () => uploadZone.classList.remove('drag-over'));
uploadZone.addEventListener('drop', e => {
  e.preventDefault();
  uploadZone.classList.remove('drag-over');
  const file = e.dataTransfer?.files[0];
  if (file && file.type.startsWith('image/')) {
    const dt = new DataTransfer();
    dt.items.add(file);
    imageInput.files = dt.files;
    showPreview(file);
  }
});

removeImgBtn.addEventListener('click', e => {
  e.preventDefault();
  e.stopPropagation();
  clearImagePreview();
  imageInput.value = '';
});

function showPreview(file) {
  const url = URL.createObjectURL(file);
  imgPreview.src = url;
  imgPreview.classList.remove('hidden');
  placeholder.classList.add('hidden');
  removeImgBtn.classList.remove('hidden');
  imageInput.style.display = 'none';
}

function clearImagePreview() {
  imgPreview.src = '';
  imgPreview.classList.add('hidden');
  placeholder.classList.remove('hidden');
  removeImgBtn.classList.add('hidden');
  imageInput.style.display = '';
}

/* ── Delete (fila) ───────────────────────────────────────────────────────── */
function confirmDelete(id) {
  const post = queue.find(p => p.id === id);
  if (!post) return;
  pendingDeleteId = id;
  pendingDeleteQuoteId = null;
  modalMsg.textContent = `Excluir o post agendado para ${new Date(post.scheduledAt).toLocaleString('pt-BR')}?`;
  modalBackdrop.classList.remove('hidden');
}

modalCancel.addEventListener('click', () => {
  modalBackdrop.classList.add('hidden');
  pendingDeleteId = null;
  pendingDeleteQuoteId = null;
});

modalBackdrop.addEventListener('click', e => {
  if (e.target === modalBackdrop) {
    modalBackdrop.classList.add('hidden');
    pendingDeleteId = null;
    pendingDeleteQuoteId = null;
  }
});

modalConfirm.addEventListener('click', async () => {
  modalBackdrop.classList.add('hidden');

  if (pendingDeleteId) {
    const res = await fetch(`/api/queue/${pendingDeleteId}`, { method: 'DELETE' });
    pendingDeleteId = null;
    if (res.ok) await loadQueue();
    else alert('Erro ao excluir post.');
  } else if (pendingDeleteQuoteId !== null) {
    const res = await fetch(`/api/quotes/${pendingDeleteQuoteId}`, { method: 'DELETE' });
    pendingDeleteQuoteId = null;
    if (res.ok) await loadQuotes();
    else alert('Erro ao excluir quote.');
  }
});

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
  // Collect unique games from full list (always fetch without filter for counts)
  const allGames = [...new Set((meta?._allGames || []))];
  // We'll just use predefined games for the filter pills
  const knownGames = [
    'Fallout', 'Fallout 2', 'Fallout 3', 'Fallout: New Vegas',
    'Fallout 4', 'Fallout TV Series (2024)',
  ];

  quoteTotalBadge.textContent = `${quotes.length} quote${quotes.length !== 1 ? 's' : ''}`;

  // Build pills from actual data if we don't have a full-count meta
  gameFiltersEl.innerHTML = '';

  const allBtn = document.createElement('button');
  allBtn.className = `filter${activeGame === 'all' ? ' active' : ''}`;
  allBtn.dataset.game = 'all';
  allBtn.textContent = 'Todos';
  gameFiltersEl.appendChild(allBtn);

  // Get unique games present in current quotes (or all known)
  const gamesInData = [...new Set(quotes.map(q => {
    // Normalize DLC sub-games under their parent
    if (q.game.startsWith('Fallout: New Vegas')) return 'Fallout: New Vegas';
    return q.game;
  }))].sort();

  gamesInData.forEach(game => {
    const btn = document.createElement('button');
    btn.className = `filter${activeGame === game ? ' active' : ''}`;
    btn.dataset.game = game;
    btn.textContent = game.replace('Fallout: New Vegas', 'New Vegas')
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

  // Client-side game filter for DLC sub-entries
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
        <button class="btn-schedule" data-id="${qt.id}">Agendar</button>
        <button class="btn-edit" data-id="${qt.id}">Editar</button>
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
  quotesList.querySelectorAll('.btn-schedule').forEach(btn => {
    btn.addEventListener('click', () => openScheduleModal(parseInt(btn.dataset.id, 10)));
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
    quoteModalTitle.textContent = 'Editar Quote';
    quoteModalSubmit.textContent = 'Salvar';
    quoteIdInput.value = qt.id;
    quoteTextInput.value = qt.quote;
    quoteCharacterInput.value = qt.character;
    quoteGameInput.value = qt.game;
    quoteTagsInput.value = (qt.tags || []).join(', ');
  } else {
    quoteModalTitle.textContent = 'Nova Quote';
    quoteModalSubmit.textContent = 'Criar';
    quoteIdInput.value = '';
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
  pendingDeleteId = null;
  modalMsg.textContent = `Excluir a quote de ${qt.character}?`;
  modalBackdrop.classList.remove('hidden');
}

/* ── Quotes: agendar na fila ─────────────────────────────────────────────── */
function openScheduleModal(id) {
  const qt = quotes.find(q => q.id === id);
  if (!qt) return;
  pendingScheduleQuote = qt;

  const formatted = `"${qt.quote}" — ${qt.character}, ${qt.game}\n\n#Fallout #FalloutQuotes`;
  schedulePreview.textContent = formatted;

  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setMinutes(0, 0, 0);
  scheduleModalInput.value = toLocalDatetimeInput(d);

  scheduleModalBackdrop.classList.remove('hidden');
}

scheduleModalCancel.addEventListener('click', () => {
  scheduleModalBackdrop.classList.add('hidden');
  pendingScheduleQuote = null;
});
scheduleModalBackdrop.addEventListener('click', e => {
  if (e.target === scheduleModalBackdrop) {
    scheduleModalBackdrop.classList.add('hidden');
    pendingScheduleQuote = null;
  }
});

scheduleModalConfirm.addEventListener('click', async () => {
  if (!pendingScheduleQuote || !scheduleModalInput.value) return;

  const qt = pendingScheduleQuote;
  const caption = `"${qt.quote}" — ${qt.character}, ${qt.game}\n\n#Fallout #FalloutQuotes`;

  scheduleModalBackdrop.classList.add('hidden');
  pendingScheduleQuote = null;

  const formData = new FormData();
  formData.set('caption', caption);
  formData.set('scheduledAt', scheduleModalInput.value);
  formData.set('quoteId', qt.id.toString());

  const res = await fetch('/api/queue', { method: 'POST', body: formData });
  if (res.ok) {
    // Switch to queue tab
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelector('.tab-btn[data-tab="queue"]').classList.add('active');
    quoteSection.classList.add('hidden');
    queueSection.classList.remove('hidden');
    await loadQueue();
  } else {
    const data = await res.json();
    alert(data.error || 'Erro ao agendar.');
  }
});

/* ── Helpers ─────────────────────────────────────────────────────────────── */
function toLocalDatetimeInput(date) {
  const pad = n => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth()+1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/* ── Init ────────────────────────────────────────────────────────────────── */
checkAuth();
