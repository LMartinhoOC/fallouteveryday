# ☢️ Fallout Out of Context

> *"nan-ni shimasho-ka?"*

Bot no Twitter/X que posta falas aleatórias do Fallout, sem contexto, em minúsculo — como se fosse um maluco recitando de memória. Roda de graça no GitHub Actions, 15x por dia, e tem um painel web pra curadoria.

**Estado atual:** 🟢 **LIVE em produção** · **93.814 quotes** no banco · 15 posts/dia · cobre Fallout 1, 2, 3, New Vegas (+ DLCs), 4 (+ Nuka-World) e TV Series (2024).

---

## Como funciona

O bot sorteia uma fala aleatória do banco que ainda não foi postada, converte pra minúsculo, e posta. Nada de fila curada obrigatória, nada de agendamento manual — puro caos controlado.

```
data/quotes.json  ──┐
 (banco master)     ├──►  src/bot.js  ──►  Twitter/X API
data/state.json  ───┘         │
 (log de posts)               ▼
                    state.posted.push({id, tweetId, postedAt})
                              │
                              ▼
                   git commit data/state.json    (GitHub Action)
```

### Garantia de não-repetição

Essa é a parte mais importante da arquitetura. O mecanismo inteiro de dedup depende de **dois arquivos + uma regra simples**:

1. **`data/quotes.json`** é o banco master. Imutável em produção. Cada quote tem um `id` estável que nunca muda.
2. **`data/state.json`** é o log. Cada post gera uma entrada `{id, tweetId, postedAt}` em `state.posted`.
3. Em cada execução, [src/bot.js](src/bot.js) monta um `Set` dos IDs já postados, filtra o banco pra obter o pool de não-postadas, e sorteia uma.
4. Depois de postar com sucesso, appenda a nova entrada em `state.posted` e **grava o arquivo**.
5. Em produção, o GitHub Action faz `git commit` + `git push` (com retry/rebase) pra que a próxima run já veja o estado novo.
6. Quando o pool esvaziar (todas as 93k quotes postadas), o ciclo recomeça do zero. Na prática isso leva ~17 anos ao ritmo atual — é mais salvaguarda do que funcionalidade.

**Regra de ouro:** nunca edite IDs em `quotes.json`. A dedup inteira depende deles serem estáveis. Só adicionar novas quotes com `id = max+1`.

### Fila pinada (prioridade)

Além do sorteio, existe `state.pinned = [id1, id2, ...]` — uma fila FIFO. Se tiver algo nela, o bot consome o primeiro ID dali ao invés de sortear. O painel web gerencia via botões de "Agendar". Quotes pinadas também entram em `state.posted` depois de postadas, então a dedup natural cobre.

---

## Stack

| Módulo | Função |
|--------|--------|
| [src/bot.js](src/bot.js) | Núcleo: `postNext()` — lê quotes+state, sorteia não-postada, posta, grava state |
| [src/scheduler.js](src/scheduler.js) | Wraps `postNext()` em `node-cron` job (uso local apenas) |
| [start.js](start.js) | Entry do `npm start` — sobe scheduler + painel juntos |
| [panel/server.js](panel/server.js) | Express + session auth. Painel web + REST API |
| [panel/public/](panel/public) | Frontend vanilla JS (`index.html`, `app.js`, `style.css`) |
| [data/quotes.json](data/quotes.json) | Banco master (93.8k quotes). **Imutável em prod.** |
| [data/state.json](data/state.json) | Log de posts: `{posted: [...], pinned: [...]}` |
| [.github/workflows/post.yml](.github/workflows/post.yml) | GitHub Action — 15 crons/dia + commit de state.json |
| [scripts/scrape-wikiquote.js](scripts/scrape-wikiquote.js) | Scraper Wikiquote (quotes curadas) |
| [scripts/scrape-fandom.js](scripts/scrape-fandom.js) | Scraper Fandom por lista de personagens hardcoded |
| [scripts/scrape-category.js](scripts/scrape-category.js) | Scraper Fandom por categoria (FO4, FONV, FO3, NUKA) — auto-descobre páginas |

---

## Setup

### 1. Instalar dependências

```bash
npm install
```

### 2. Configurar variáveis de ambiente

Cria um `.env` na raiz:

```env
X_API_KEY=
X_API_SECRET=
X_ACCESS_TOKEN=
X_ACCESS_TOKEN_SECRET=
PANEL_PASSWORD=
SESSION_SECRET=
CRON_SCHEDULE=0 * * * *
PORT=3000
MOCK_MODE=false
```

> **Twitter API:** precisa de permissão **Read + Write** no Developer Portal e pelo menos $5 de crédito no plano pay-as-you-go.

**Hash bcrypt pra `PANEL_PASSWORD`** (recomendado em prod):

```bash
node -e "require('bcryptjs').hash('SUA_SENHA', 10).then(console.log)"
```

### 3. Rodar

```bash
npm start              # scheduler + painel juntos
npm run bot            # dispara 1 post imediatamente
npm run panel          # só o painel (porta 3000)
npm run scheduler      # só o cron local
```

Dev sem postar de verdade: `MOCK_MODE=true` no `.env` — simula tweet retornando ID `MOCK_<timestamp>`.

---

## Hosting: GitHub Actions (gratuito)

O jeito mais simples de rodar sem servidor é via GitHub Actions. O workflow já está em [.github/workflows/post.yml](.github/workflows/post.yml).

Roda **15x por dia** distribuído entre 8h BRT e 22h BRT, pra cobrir horário nobre do Brasil, EUA e Europa:

| UTC | BRT | EST | CET |
|-----|-----|-----|-----|
| 11:00–20:00 (de hora em hora) | 8h–17h | 6h–15h | 12h–21h |
| 21:00, 22:00, 23:00 | 18h, 19h, 20h | 16h, 17h, 18h | 22h, 23h, 0h |
| 00:00, 01:00 | 21h, 22h | 19h, 20h | — |

Tem um `sleep 0–4s` antes de cada post pra evitar horários redondos demais.

### Configurar

1. Sobe o repo pro GitHub
2. Vai em **Settings → Secrets and variables → Actions**
3. Adiciona os 4 secrets:
   - `X_API_KEY`
   - `X_API_SECRET`
   - `X_ACCESS_TOKEN`
   - `X_ACCESS_TOKEN_SECRET`
4. Pronto — roda automaticamente no schedule configurado

> ⚠️ Qualquer push na `main` **ativa o Action imediatamente**. Confirme antes de pushar.

---

## Painel Web

Acessível em `http://localhost:3000` (senha = `PANEL_PASSWORD`).

- **Dashboard** — Totais, posts recentes com link pro tweet, schedule diário, e **breakdown ao vivo de quotes por jogo** (barra horizontal, verde = postadas, cinza = restantes). A seção "Quotes por Jogo" é a forma canônica de ver a distribuição do banco.
- **Banco de Quotes** — Busca por texto/personagem, filtro por jogo, CRUD completo, botão "Agendar" pra pinar uma quote pra próxima execução.
- **Sincronizar** — Puxa o `state.json` do raw.githubusercontent (prod) pra ficar em sync com o bot.
- **Backfill Twitter** — Busca seus tweets recentes e preenche `state.posted` (útil se você perdeu histórico).

### REST API

| Método | Path | Descrição |
|---|---|---|
| GET | `/api/me` | Checa sessão |
| POST | `/api/login` | Login via `password` |
| POST | `/api/logout` | Destroi sessão |
| POST | `/api/sync` | Puxa `state.json` do GitHub raw |
| GET | `/api/stats` | Totais + `byGame: [{game,total,posted,remaining}]` |
| GET | `/api/recent?limit=N` | Últimos N posts (máx 50) |
| GET | `/api/schedule` | Slots cron parseados em BRT/UTC |
| POST | `/api/backfill` | Preenche state a partir do timeline do Twitter |
| GET | `/api/pinned` | Lista IDs na fila pinada |
| POST | `/api/quotes/:id/pin` | Adiciona à fila pinada |
| DELETE | `/api/quotes/:id/pin` | Remove da fila pinada |
| GET | `/api/quotes?q=&game=&limit=&offset=` | Lista paginada, busca + filtro |
| POST | `/api/quotes` | Cria quote (id = max+1) |
| PUT | `/api/quotes/:id` | Edita quote |
| DELETE | `/api/quotes/:id` | Remove quote |

Todas autenticadas via sessão, exceto `/api/me` e `/api/login`.

---

## Banco de quotes (`data/quotes.json`)

**93.814 quotes**, 75+ personagens, todos os jogos principais.

### Distribuição por jogo

Visível em tempo real no dashboard. Snapshot atual:

| Jogo | Quotes |
|---|---|
| Fallout 4 | 54.369 |
| Fallout: New Vegas | 19.822 |
| Fallout 3 | 19.598 |
| Fallout 2 | 7 |
| Fallout: New Vegas — Honest Hearts | 6 |
| Fallout TV Series (2024) | 5 |
| Fallout (1) | 3 |
| Fallout: New Vegas — Lonesome Road | 3 |
| Fallout: New Vegas — Dead Money | 1 |

Maioria vem dos scrapers de dialogue files do Fandom (raw scripts), o que explica o volume desproporcional. As entradas de Fallout 1/2 e TV Series são curadas manualmente (Wikiquote, sites de quotes).

### Formato

```json
{
  "_meta": { "total": 93814, "sources": [...] },
  "quotes": [
    { "id": 1, "quote": "War. War never changes.", "character": "Narrator (Ron Perlman)", "game": "Fallout" }
  ]
}
```

### State

```json
{
  "posted": [ { "id": 8, "tweetId": "1234567890", "postedAt": "2026-04-17T01:41:57Z" } ],
  "pinned": [ 42, 88 ]
}
```

---

## Scrapers

Três scripts independentes, todos com modo dry-run (stdout JSON) e flag `--merge` pra aplicar direto em `quotes.json`.

### `scripts/scrape-wikiquote.js`

Raspa o [Wikiquote](https://en.wikiquote.org) via MediaWiki API. Bom pra quotes curadas manualmente.

```bash
node scripts/scrape-wikiquote.js                   # todos os jogos
node scripts/scrape-wikiquote.js "Fallout 2"       # jogo específico
node scripts/scrape-wikiquote.js --merge           # aplica no quotes.json
```

### `scripts/scrape-fandom.js`

Raspa o [Fallout Wiki](https://fallout.fandom.com) — páginas `.txt` com scripts completos. Suporta dois formatos de template: FO4 (`{{Dialogue FO4|row}}`) e NV/FO3 (tabela wikitext com `{{Inline quote}}`). Usa uma lista hardcoded de personagens.

```bash
node scripts/scrape-fandom.js                      # todos os personagens da lista
node scripts/scrape-fandom.js Codsworth            # um personagem
node scripts/scrape-fandom.js --merge
```

### `scripts/scrape-category.js`

Auto-descobre páginas via categoria do Fandom — sem lista hardcoded. Categorias disponíveis: `FO4`, `FONV`, `FO3`, `NUKA`.

```bash
node scripts/scrape-category.js                   # todos os games, dry-run
node scripts/scrape-category.js --game NUKA       # só Nuka-World
node scripts/scrape-category.js --merge
node scripts/scrape-category.js --list            # só lista páginas, não raspa
node scripts/scrape-category.js --limit 20        # max 20 páginas por game (pra testar)
```

Sempre salva um relatório em `data/scrape-report-<timestamp>.json` com stats por página.

> **Gotcha:** a inferência de personagem a partir do nome da página é baseada em regex de prefixos (`DLC04`, `MQ08`, `ConvGeneric`, etc.). Alguns prefixos escapam — ex: `NIRA` → `ira`, `Nukatron` → `ukatron`, `Camp CT04Cora` não é limpo. Sempre valide o output antes de `--merge`.

---

## Variáveis de ambiente

| Variável | Padrão | Obrig. | Descrição |
|---|---|---|---|
| `X_API_KEY` | — | ✅ | Twitter API key |
| `X_API_SECRET` | — | ✅ | Twitter API secret |
| `X_ACCESS_TOKEN` | — | ✅ | Access token (Read+Write) |
| `X_ACCESS_TOKEN_SECRET` | — | ✅ | Access token secret |
| `PANEL_PASSWORD` | — | ⚠️ | Senha do painel — hash bcrypt (recomendado) ou texto puro |
| `SESSION_SECRET` | `dev-secret-change-me` | ⚠️ | Secret de sessão Express — trocar em prod |
| `CRON_SCHEDULE` | `0 * * * *` | ❌ | Cron local (prod usa `post.yml`, ignora isto) |
| `PORT` | `3000` | ❌ | Porta do painel |
| `MOCK_MODE` | `false` | ❌ | `true` simula tweet sem bater na API |

---

## Gotchas

- 🟢 **LIVE — push na `main` ativa o Action.** Confirme antes de pushar.
- O bot commita `state.json` após cada post. Edite local com cuidado; use `/api/sync` antes se precisar do state mais recente.
- Não edite IDs em `quotes.json`. Só adicionar com `id = max+1`.
- `scripts/populate-queue.js` e `data/scheduled.json` são legado — arquitetura atual é random pick, não fila.
- Rodar com `MOCK_MODE=true` grava IDs `MOCK_<timestamp>` em `state.json`. **Não commite state depois de rodar mock** — a Action ia tentar achar tweets que não existem.
- Painel tem auth session-based simples — não expor publicamente sem HTTPS + hash bcrypt.

---

## Comandos

```bash
npm start              # scheduler + painel (start.js)
npm run bot            # dispara 1 post — o que a Action chama em prod
npm run panel          # só o painel
npm run scheduler      # só o cron local
npm run backfill       # reconstroi state.json do timeline (uso raro)

node scripts/scrape-wikiquote.js [--merge] [jogo]
node scripts/scrape-fandom.js    [--merge] [personagem]
node scripts/scrape-category.js  [--merge] [--game KEY] [--limit N] [--list]
```

---

## Licença

Sem licença formal. Fallout e personagens são propriedade da Bethesda/Interplay/Obsidian — uso educacional e não-comercial.
