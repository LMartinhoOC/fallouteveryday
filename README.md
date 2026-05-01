# ☢️ Fallout Out of Context

> *"nan-ni shimasho-ka?"*

[Bot no Twitter/X](https://x.com/DailyQuotesFA) que posta falas aleatórias do Fallout, sem contexto, em minúsculo — como se fosse um maluco recitando de memória. Roda de graça no GitHub Actions, 5x por dia.

**Estado atual:** 🟢 **LIVE em produção** · **93.790 quotes** no banco · 5 posts/dia · cobre Fallout (algumas poucas falas) do 1, 2. Temos uma cobertura bem maior do 3, New Vegas (+ DLCs), 4 (+ Nuka-World).

---

## Como funciona

O bot sorteia uma fala aleatória do banco que ainda não foi postada, converte pra minúsculo, e posta. Nada de fila curada obrigatória, nada de agendamento manual — puro caos controlado.

```
data/quotes.json  ──┐
 (banco master)     ├──►  src/bot.js  ──►  Twitter/X API
data/state.json  ───┘    postNext()         │
 (log de posts)              │              └─ tweet (quote em minúsculo)
                             ▼
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

---

## Stack

| Módulo | Função |
|--------|--------|
| [src/bot.js](src/bot.js) | Núcleo: `postNext()` sorteia uma quote não-postada, posta em minúsculo e atualiza `state.posted` |
| [src/scheduler.js](src/scheduler.js) | Wraps `postNext()` em `node-cron` job (uso local apenas) |
| [start.js](start.js) | Entry do `npm start` — sobe o scheduler local |
| [data/quotes.json](data/quotes.json) | Banco master (93.8k quotes). **Imutável em prod.** |
| [data/state.json](data/state.json) | Log de posts: `{posted: [...], pinned?: [...]}` |
| [.github/workflows/post.yml](.github/workflows/post.yml) | GitHub Action — 5 crons/dia + commit de state.json |
| [scripts/scrape-wikiquote.js](scripts/scrape-wikiquote.js) | Scraper Wikiquote (quotes curadas) |
| [scripts/scrape-fandom.js](scripts/scrape-fandom.js) | Scraper Fandom por lista de personagens hardcoded |
| [scripts/scrape-category.js](scripts/scrape-category.js) | Scraper Fandom por categoria (FO4, FONV, FO3, NUKA) — auto-descobre páginas |
| [scripts/lint-quotes.js](scripts/lint-quotes.js) | Lint do banco — detecta stage directions, markup wiki, IDs técnicos, etc. |

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
CRON_SCHEDULE=0 * * * *
MOCK_MODE=false
```

> **Twitter API:** precisa de permissão **Read + Write** no Developer Portal e pelo menos $5 de crédito no plano pay-as-you-go.

### 3. Rodar

```bash
npm start              # scheduler local
npm run bot            # dispara 1 post imediatamente
npm run scheduler      # só o cron
```

Dev sem postar de verdade: `MOCK_MODE=true` no `.env` — simula tweet retornando ID `MOCK_<timestamp>`.

---

## Hosting: GitHub Actions (gratuito)

O jeito mais simples de rodar sem servidor é via GitHub Actions. O workflow já está em [.github/workflows/post.yml](.github/workflows/post.yml).

Roda **5x por dia** em janelas concentradas no prime time US/global (audiência maior pra conteúdo Fallout em inglês). Os minutos do cron são propositalmente "estranhos" e há um jitter `0–60s` antes de postar, pra fugir da assinatura visual de bot (`:00:00`) que o Grok detecta:

| UTC | EST | BRT | Janela |
|-----|-----|-----|--------|
| `13:07` | 09:07 | 10:07 | manhã US, almoço Europa |
| `15:23` | 11:23 | 12:23 | almoço US |
| `19:41` | 15:41 | 16:41 | fim de expediente US, início prime BR |
| `22:12` | 18:12 | 19:12 | prime time US |
| `00:38` | 20:38 | 21:38 | late US |

Cada execução faz: jitter 0–60s → post. Tempo total de poucos segundos por run.

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

## Banco de quotes (`data/quotes.json`)

**93.790 quotes**, 1.355 personagens únicos, todos os jogos principais.

### Distribuição por jogo

| Jogo | Quotes |
|---|---|
| Fallout 4 | 54.369 |
| Fallout: New Vegas | 19.798 |
| Fallout 3 | 19.598 |
| Fallout 2 | 7 |
| Fallout: New Vegas — Honest Hearts | 6 |
| Fallout (TV Series, 2024) | 5 |
| Fallout | 3 |
| Fallout: New Vegas — Lonesome Road | 3 |
| Fallout: New Vegas — Dead Money | 1 |

A Maioria vem dos scrapers de dialogue files do Fandom (raw scripts), o que explica o volume desproporcional. As entradas de Fallout 1/2 e TV Series são curadas manualmente (Wikiquote, sites de quotes).

### Formato

```json
{
  "_meta": { "total": 93790, "sources": [...] },
  "quotes": [
    { "id": 1, "quote": "War. War never changes.", "character": "Narrator (Ron Perlman)", "game": "Fallout" }
  ]
}
```

### State

```json
{
  "posted": [
    {
      "id": 8,
      "tweetId": "1234567890",
      "postedAt": "2026-04-17T01:41:57Z"
    }
  ]
}
```

> Entradas antigas podem ter um campo `revealId` — vestígio do reveal-em-thread (descontinuado em 2026-05-01). Histórico preservado, sem migração.

#### Fila de pinned (opcional)

Se `state.json` tiver um campo `pinned: [id1, id2, ...]`, o bot consome essa fila **antes** de sortear aleatório. Útil pra agendar uma quote específica pro próximo post (ex: anúncio de série, data temática). Cada run remove o primeiro ID da fila. Quando a fila esvazia, volta ao sorteio normal.

```json
{
  "pinned": [42, 1337],
  "posted": [...]
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

## Lint & curadoria (`scripts/lint-quotes.js`)

Os scrapers pegam tudo que parece fala — o que inclui muito lixo: stage directions (`[Crying]`, `*sighs*`), markup wiki vazado (`[[Link]]`, `{{template}}`, pipes), placeholders (`<PlayerName>`), identificadores técnicos do jogo, etc. O lint percorre [data/quotes.json](data/quotes.json) e sinaliza tudo isso via regras nomeadas.

```bash
node scripts/lint-quotes.js                    # resumo + 10 exemplos por regra
node scripts/lint-quotes.js --all              # todos os matches
node scripts/lint-quotes.js --rule bracket-tag # só uma regra
node scripts/lint-quotes.js --out report.json  # JSON completo
node scripts/lint-quotes.js --ids              # só IDs, um por linha (pra pipe)
```

O script **não modifica** `quotes.json` — só sinaliza. Correções são manuais (editar ou deletar a quote, já respeitando a regra de IDs estáveis: deletar é OK, renumerar não).

### Regras atuais

| Regra | O que detecta | Severidade |
|---|---|---|
| `skill-check` | Marcadores tipo `[SUCCEEDED]`, `[Speech 75]` | alta |
| `bracket-tag` | Tag entre colchetes — `[Crying]`, `[Whispers]` | alta |
| `curly-stage` | Tag entre chaves — `{angry}`, `{laughs}` | alta |
| `asterisk-action` | Ação entre asteriscos — `*sighs*`, `*looks away*` | alta |
| `angle-placeholder` | Placeholder em `<>` — `<PlayerName>`, `<Alias:Foo>` | alta |
| `wiki-link`, `wiki-template`, `wiki-bold-italic` | Markup MediaWiki vazado — `[[X]]`, `{{Y}}`, `''z''` | alta/média |
| `html-entity` | Entidade HTML não decodificada — `&quot;`, `&#39;` | média |
| `pipe-or-tab` | Pipe ou tab (leak de wikitext) | alta |
| `paren-stage` | Parênteses com palavra minúscula — `(laughs)`, `(whispering)` | média |
| `speaker-label` | Prefixo `Nome:` no começo | baixa |
| `all-caps`, `too-short`, `too-long` | Heurísticas básicas | baixa/média |
| `non-printable` | Caractere de controle | alta |
| `story-event-id` | ID técnico vazado — `VStoryEventXxx set to N.` | alta |

> **Nota:** API programática também é exportada (`runLint`, `findingsForRule`, `autoFix`, `RULES`, `FIXERS`) pra uso em tooling externo.

---

## Variáveis de ambiente

| Variável | Padrão | Obrig. | Descrição |
|---|---|---|---|
| `X_API_KEY` | — | ✅ | Twitter API key |
| `X_API_SECRET` | — | ✅ | Twitter API secret |
| `X_ACCESS_TOKEN` | — | ✅ | Access token (Read+Write) |
| `X_ACCESS_TOKEN_SECRET` | — | ✅ | Access token secret |
| `CRON_SCHEDULE` | `0 * * * *` | ❌ | Cron local (prod usa `post.yml`, ignora isto) |
| `MOCK_MODE` | `false` | ❌ | `true` simula tweet sem bater na API |

---

## Gotchas

- 🟢 **LIVE — push na `main` ativa o Action.** Confirme antes de pushar.
- O bot commita `state.json` após cada post. Se você editar local, cuidado com conflitos — faça `git pull` antes.
- Não edite IDs em `quotes.json`. Só adicionar com `id = max+1`.
- Rodar com `MOCK_MODE=true` grava IDs `MOCK_<timestamp>` em `state.json`. **Não commite state depois de rodar mock** — a Action ia tentar achar tweets que não existem.

---

## Comandos

```bash
npm start              # scheduler local
npm run bot            # dispara 1 post — o que a Action chama em prod
npm run scheduler      # só o cron local
npm run backfill       # reconstroi state.json do timeline (uso raro)

node scripts/scrape-wikiquote.js [--merge] [jogo]
node scripts/scrape-fandom.js    [--merge] [personagem]
node scripts/scrape-category.js  [--merge] [--game KEY] [--limit N] [--list]

node scripts/lint-quotes.js      [--all] [--rule NAME] [--out FILE] [--ids]
```

---

## Licença

Sem licença formal. Fallout e personagens são propriedade da Bethesda/Interplay/Obsidian — uso educacional e não-comercial.
