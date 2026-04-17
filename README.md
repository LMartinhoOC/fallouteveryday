# ☢️ Fallout Out of Context

> *"nan-ni shimasho-ka?"*

Bot no Twitter/X que posta falas do Fallout sem contexto, em minúsculo, uma por hora — como se fosse um maluco recitando de memória.

---

## Como funciona

O bot sorteia uma frase aleatória do banco de 21k+ quotes, converte pra minúsculo e posta no Twitter. Sem fila, sem curadoria obrigatória — puro caos controlado.

### Fluxo

```
data/quotes.json  ──►  src/bot.js  ──►  Twitter/X API
     (21k quotes)      (random pick)
```

1. **Bot** lê `data/quotes.json`, pega uma quote aleatória que ainda não foi postada
2. Converte pra minúsculo e posta via Twitter API v2
3. Salva `lastPostedAt` na quote para não repetir
4. Quando todas forem postadas, o ciclo recomeça

---

## Stack

| Módulo | Função |
|--------|--------|
| `src/bot.js` | Lógica de posting (random pick + post + mark) |
| `src/scheduler.js` | Cron job via `node-cron` (fallback local) |
| `panel/server.js` | Painel web de gerenciamento (porta 3000) |
| `scripts/scrape-wikiquote.js` | Scraper do Wikiquote (en.wikiquote.org) |
| `scripts/scrape-fandom.js` | Scraper do Fandom Wiki (fallout.fandom.com) |
| `data/quotes.json` | Banco de quotes (~21k entradas) |

---

## Setup

### 1. Instalar dependências

```bash
npm install
```

### 2. Configurar variáveis de ambiente

Cria um arquivo `.env` na raiz:

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

### 3. Rodar

```bash
npm start          # scheduler + painel web juntos
npm run bot        # dispara um post imediatamente
npm run scheduler  # só o cron
npm run panel      # só o painel (porta 3000)
```

---

## Hosting: GitHub Actions (gratuito)

O jeito mais simples de rodar sem servidor é via GitHub Actions. O workflow já está em `.github/workflows/post.yml`.

### Configurar

1. Sobe o repo pro GitHub
2. Vai em **Settings → Secrets and variables → Actions**
3. Adiciona os 4 secrets:
   - `X_API_KEY`
   - `X_API_SECRET`
   - `X_ACCESS_TOKEN`
   - `X_ACCESS_TOKEN_SECRET`
4. Pronto — roda automaticamente no schedule configurado

### Alterar frequência

Edita o cron em `.github/workflows/post.yml`:

```yaml
- cron: '0 * * * *'    # toda hora
- cron: '0 9 * * *'    # todo dia às 9h UTC
- cron: '0 */3 * * *'  # a cada 3 horas
```

---

## Banco de quotes (`data/quotes.json`)

**~21.137 quotes**, 75+ personagens, todos os jogos principais.

### Jogos cobertos

- Fallout 1 e 2
- Fallout 3
- Fallout: New Vegas (+ DLCs Honest Hearts, Lonesome Road, Dead Money)
- Fallout 4
- Fallout (TV Series, 2024)

### Personagens principais

Codsworth, Nick Valentine, Cait, Deacon, Curie, Piper, MacCready, Hancock, Preston, Strong, Danse, X6-88, Benny, Yes Man, Mr. House, Caesar, Legate Lanius, Ulysses, Joshua Graham, Three Dog, Liberty Prime, Veronica, Arcade Gannon, Raul, Cass, Craig Boone, Lily, Fawkes, Charon, Moira Brown, Takahashi, Raiders, Super Mutants, Protectrons, e mais.

### Estrutura

```json
{
  "_meta": { "total": 21137 },
  "quotes": [
    {
      "id": 21143,
      "quote": "Nan-ni shimasho-ka?",
      "character": "Takahashi",
      "game": "Fallout 4",
      "lastPostedAt": null
    }
  ]
}
```

---

## Scrapers

### `scripts/scrape-wikiquote.js`

Raspa o [Wikiquote](https://en.wikiquote.org) via MediaWiki API. Bom para quotes curadas manualmente.

```bash
node scripts/scrape-wikiquote.js                   # todos os jogos
node scripts/scrape-wikiquote.js "Fallout 2"       # jogo específico
node scripts/scrape-wikiquote.js --merge           # merge no quotes.json
```

### `scripts/scrape-fandom.js`

Raspa o [Fallout Wiki](https://fallout.fandom.com) — páginas `.txt` com os scripts completos dos jogos. Suporta dois formatos de template: FO4 (`{{Dialogue FO4|row}}`) e NV/FO3 (tabela wikitext com `{{Inline quote}}`).

```bash
node scripts/scrape-fandom.js                      # todos os personagens
node scripts/scrape-fandom.js Codsworth            # personagem específico
node scripts/scrape-fandom.js --merge              # merge no quotes.json
```

**Personagens disponíveis:** Codsworth, Cait, Deacon, Curie, Piper, Nick Valentine, MacCready, Hancock, Preston, Strong, Danse, X6-88, Protectron, Mister Handy, Mister Gutsy, Assaultron, Raider, Super Mutant, Minuteman, Veronica, Arcade Gannon, Raul, Cass, Benny, Yes Man, Mr. House, Legate Lanius, Mr. New Vegas, Ulysses, Joshua Graham, Three Dog, Liberty Prime, Fawkes, Charon, Star Paladin Cross, Butch, Colonel Autumn, Moira Brown, Harold, Tenpenny, Pinkerton, Mister Burke, MacCready (kid), Confessor Cromwell, Craig Boone, ED-E, Lily, Caesar, Legion Soldier, Swank, Sunny Smiles, Papa Khan, Victor, Diamond City Security, Dogmeat, Takahashi

---

## Painel Web

Acessível em `http://localhost:3000` com a senha definida em `PANEL_PASSWORD`.

Permite visualizar o histórico de posts (via `data/scheduled.json` — legado, não usado ativamente pelo bot novo).

---

## Variáveis de ambiente

| Variável | Padrão | Descrição |
|----------|--------|-----------|
| `X_API_KEY` | — | Twitter API key |
| `X_API_SECRET` | — | Twitter API secret |
| `X_ACCESS_TOKEN` | — | Twitter access token (Read+Write) |
| `X_ACCESS_TOKEN_SECRET` | — | Twitter access token secret |
| `PANEL_PASSWORD` | — | Senha do painel web |
| `SESSION_SECRET` | — | Secret para sessões Express |
| `CRON_SCHEDULE` | `0 9 * * *` | Schedule do cron (formato cron) |
| `PORT` | `3000` | Porta do painel web |
| `MOCK_MODE` | `false` | `true` = simula sem postar de verdade |
