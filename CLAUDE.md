# fallouteveryday — Agent Reference

## Project Overview

**Fallout Out of Context** — Twitter/X bot que posta falas aleatórias do Fallout em minúsculo, sem contexto. 15 posts/dia distribuídos ao longo das 24h, sem fila curada — sorteio puro sobre o banco de quotes.

- **Stack:** Node.js 20 + `twitter-api-v2` + Express (painel) + `node-cron` (local) / GitHub Actions (prod)
- **Status:** 🟢 **LIVE** — rodando em produção via GitHub Actions (push na `main` → deploy imediato, porque o Action roda direto do repo)
- **Banco atual:** 93.814 quotes cobrindo Fallout 1, 2, 3, New Vegas (+ DLCs Honest Hearts, Lonesome Road, Dead Money, Old World Blues), 4 (+ Nuka-World), e TV Series (2024)
- **Repo de produção:** `LMartinhoOC/fallouteveryday` (branch `main`)

## Quick Start

```bash
npm install
cp .env.example .env   # se existir; senão criar do zero (ver Configuration)

npm start              # scheduler + painel juntos (local)
npm run bot            # dispara 1 post imediatamente (prod faz isto no cron)
npm run panel          # só o painel web (porta 3000)
npm run scheduler      # só o cron local
```

Dev/teste sem mexer no Twitter real: `MOCK_MODE=true` no `.env`.

## Architecture

### Fluxo de posting

```
data/quotes.json ──┐
                   ├──► src/bot.js ──► Twitter API v2
data/state.json ───┘        │
     (posted[])             ▼
                     state.posted.push({id, tweetId, postedAt})
                            │
                            ▼
                     git commit data/state.json   (feito pelo GitHub Action)
```

### Garantia de não-repetição

O mecanismo de dedup mora em [src/bot.js](src/bot.js) e depende **100% do `data/state.json`**. Passo a passo:

1. `postNext()` lê `data/quotes.json` (banco master, imutável em prod) e `data/state.json` (log de posts).
2. Monta um `Set` com todos os IDs já postados: `postedIds = new Set(state.posted.map(p => p.id))`.
3. Filtra `quotes.json` pra obter o pool de não-postadas: `unposted = quotes.filter(q => !postedIds.has(q.id))`.
4. Sorteia uma quote do pool: `pool[Math.floor(Math.random() * pool.length)]`.
5. Após postar com sucesso, **appenda** `{id, tweetId, postedAt}` em `state.posted` e grava o arquivo.
6. Em produção, o GitHub Action faz `git commit data/state.json` e dá `git push` (com rebase+retry pra lidar com jobs concorrentes). Isso garante que o próximo run vê o estado atualizado.
7. **Reentrada do ciclo:** quando `unposted.length === 0`, o fallback é `pool = data.quotes` (tudo de novo). Na prática isso só aconteceria depois de ~17 anos ao ritmo atual, então é mais salvaguarda que funcionalidade.

**Fila pinada (prioridade):** `state.pinned = [id1, id2, ...]` é um array FIFO. Se não vazio, `postNext()` consome o primeiro ID de lá ao invés de sortear. O painel web gerencia isso via `POST/DELETE /api/quotes/:id/pin`. Quotes pinadas também entram em `state.posted` depois de postadas, então a dedup natural cobre elas.

**Pontos de falha possíveis:**
- Se o `git push` falhar e o state não for commitado, a próxima run pode re-postar a quote. O workflow tem retry 3x com rebase pra mitigar isso.
- Se alguém editar `quotes.json` e renumerar IDs, o histórico quebra. **Não renumere.** IDs só crescem.
- O bot nunca modifica `quotes.json` em prod. Edição é só via painel (que deve rodar local, não em prod).

### Arquivos-chave

| Arquivo | Função |
|---|---|
| [src/bot.js](src/bot.js) | Núcleo: `postNext()` — lê quotes+state, sorteia não-postada, posta, grava state |
| [src/scheduler.js](src/scheduler.js) | Wraps `postNext` em `node-cron` job (usa `CRON_SCHEDULE`). Local/dev apenas — prod usa Actions |
| [start.js](start.js) | Entry do `npm start` — sobe scheduler + painel juntos |
| [panel/server.js](panel/server.js) | Express + session auth. Serve painel e expõe REST API |
| [panel/public/](panel/public) | Vanilla JS SPA (`index.html`, `app.js`, `style.css`) |
| [data/quotes.json](data/quotes.json) | Banco master (93.8k quotes). Formato: `{_meta, quotes: [{id, quote, character, game}]}`. **Imutável em prod** |
| [data/state.json](data/state.json) | Log de posts: `{posted: [{id, tweetId, postedAt}], pinned: [id,…]}` |
| [.github/workflows/post.yml](.github/workflows/post.yml) | GitHub Action — 15 crons/dia + commit de state.json pós-post |
| [scripts/scrape-wikiquote.js](scripts/scrape-wikiquote.js) | Scraper Wikiquote (quotes curadas) |
| [scripts/scrape-fandom.js](scripts/scrape-fandom.js) | Scraper Fandom por lista hardcoded de personagens |
| [scripts/scrape-category.js](scripts/scrape-category.js) | Scraper Fandom por categoria (FO4, FONV, FO3, NUKA) — auto-descoberta de páginas |
| [scripts/populate-queue.js](scripts/populate-queue.js) | Legado (era pra fila `scheduled.json`, não usado no modelo atual) |
| [scripts/backfill-state.js](scripts/backfill-state.js) | Reconstroi `state.json` a partir do timeline do Twitter |

## Configuration

`.env` na raiz (em prod, viram GitHub Secrets no repo):

| Variável | Padrão | Obrig. | Descrição |
|---|---|---|---|
| `X_API_KEY` | — | ✅ | Twitter API key |
| `X_API_SECRET` | — | ✅ | Twitter API secret |
| `X_ACCESS_TOKEN` | — | ✅ | Access token (permissão Read+Write) |
| `X_ACCESS_TOKEN_SECRET` | — | ✅ | Access token secret |
| `PANEL_PASSWORD` | — | ✅* | Senha do painel — pode ser hash bcrypt (recomendado) ou texto puro |
| `SESSION_SECRET` | `dev-secret-change-me` | ⚠️ | Secret de sessão Express — trocar em prod |
| `CRON_SCHEDULE` | `0 * * * *` | ❌ | Schedule do cron local. **Prod não usa isto** — usa `post.yml` |
| `PORT` | `3000` | ❌ | Porta do painel |
| `MOCK_MODE` | `false` | ❌ | `true` = simula tweet (retorna `MOCK_<timestamp>`) sem bater na API |

\* `PANEL_PASSWORD` só é obrigatória se você subir o painel; o bot em produção não precisa.

**Gerar hash bcrypt para `PANEL_PASSWORD`:**
```bash
node -e "require('bcryptjs').hash('SUA_SENHA', 10).then(console.log)"
```

**Twitter API:** plano pay-as-you-go com ≥ $5 de crédito, permissão Read+Write no Developer Portal.

## Commands / Scripts

```bash
npm start              # scheduler + painel em um processo só (start.js)
npm run bot            # dispara postNext() uma vez — o que a Action chama em prod
npm run scheduler      # só o cron local
npm run panel          # só o painel web (porta 3000)
npm run populate       # legado — não use, o modelo atual é random pick
npm run backfill       # reconstrói state.json do timeline do Twitter (uso raro)

# Scrapers (diretos, não via npm):
node scripts/scrape-wikiquote.js [--merge] [jogo]
node scripts/scrape-fandom.js    [--merge] [personagem]
node scripts/scrape-category.js  [--merge] [--game FO4|FONV|FO3|NUKA] [--limit N] [--list]
```

Todo scraper em modo dry-run escreve JSON no stdout — redirecione pra arquivo pra validar antes de `--merge`.

## API Routes

Todas autenticadas via sessão (`requireAuth`) exceto `/api/me` e `/api/login`.

| Método | Path | Descrição |
|---|---|---|
| GET | `/api/me` | Checa sessão |
| POST | `/api/login` | Login via `password` |
| POST | `/api/logout` | Destroi sessão |
| POST | `/api/sync` | Puxa `state.json` do raw.githubusercontent e salva local |
| GET | `/api/stats` | Totais + quebra por jogo (`byGame: [{game,total,posted,remaining}]`) |
| GET | `/api/recent?limit=N` | Últimos N posts (máx 50) com quote+personagem+jogo |
| GET | `/api/schedule` | Slots cron do `post.yml` parseados em BRT/UTC + qual é o próximo |
| POST | `/api/backfill` | Busca timeline do Twitter e preenche `state.posted` |
| GET | `/api/pinned` | Lista IDs na fila pinada |
| POST | `/api/quotes/:id/pin` | Adiciona à fila pinada |
| DELETE | `/api/quotes/:id/pin` | Remove da fila pinada |
| GET | `/api/quotes?q=&game=&limit=&offset=` | Lista paginada do banco, com busca + filtro por jogo |
| POST | `/api/quotes` | Cria nova quote (gera ID `max+1`) |
| PUT | `/api/quotes/:id` | Edita quote |
| DELETE | `/api/quotes/:id` | Remove quote |

## Painel Web — Dashboard

O painel em `http://localhost:3000` mostra:
- **Stats grid:** Total / Postadas / Restantes / Anos estimados no ritmo atual
- **Posts Recentes:** últimos 20 com link pro tweet
- **Schedule Diário:** slots cron parseados com indicação de qual é o próximo
- **Quotes por Jogo:** barra horizontal por jogo com `postadas/total` — atualiza em cada sync. Verde = já postado, cinza = restante.

A seção "Quotes por Jogo" é a forma canônica de ver a distribuição ao vivo do banco. Ela vem do campo `byGame` em `/api/stats`.

## Schedule de Produção

15 posts/dia distribuídos do meio-dia da manhã BR até noite. Configurado em [.github/workflows/post.yml](.github/workflows/post.yml):

| UTC | BRT | EST | CET |
|---|---|---|---|
| 11:00–20:00 (de hora em hora) | 8h–17h | 6h–15h | 12h–21h |
| 21:00, 22:00, 23:00 | 18h, 19h, 20h | 16h, 17h, 18h | 22h, 23h, 0h |
| 00:00, 01:00 | 21h, 22h | 19h, 20h | — |

O step "Random delay within window" dorme 0–4s antes de postar, pra evitar horário exatamente redondo.

## Known Issues / Gotchas

- 🟢 **LIVE — push direto pra `main` ativa o Action.** Confirme com o usuário antes de qualquer `git push`.
- O bot **commita `state.json`** após cada post. Se você editar `state.json` local e não sincronizar via `/api/sync` antes, você vai gerar conflito com o que o bot pushou.
- **Não edite IDs em `quotes.json`.** A dedup inteira depende dos IDs serem estáveis. Só adicionar novas quotes com `id = max+1`.
- `CLAUDE.md` e `README.md` podem divergir. Em caso de conflito, o código é a verdade; esse arquivo aqui é o que mais provavelmente está atualizado.
- `scripts/populate-queue.js` e a fila `scheduled.json` são legado — arquitetura atual é random pick, não fila.
- `scrape-category.js` tem regex de inferência de personagem que falha em alguns prefixos (ex: `NIRA` vira `ira`, `Nukatron` vira `ukatron`, `Camp CT04Cora` não é limpo). Checar output antes de merge.
- Painel tem auth session-based simples — **não expor publicamente sem HTTPS + hash bcrypt**.
- `MOCK_MODE=true` grava IDs `MOCK_<timestamp>` em `state.json`. Se você rodar mock localmente e depois commitar sem querer, o Action vai tentar achar esses tweets (não existem). Evite commitar state depois de rodar mock.
