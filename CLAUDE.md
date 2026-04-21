# fallouteveryday

**Documentação completa: [README.md](README.md)** — é o ponto focal deste projeto (arquitetura, fluxo de não-repetição, API, scrapers, gotchas, schedule de produção, etc.).

## Notas específicas de agente

- 🟢 **LIVE** — qualquer `git push` na `main` dispara o GitHub Action imediatamente. **Sempre confirme com o usuário antes de pushar.**
- `data/quotes.json` é **imutável em produção**. Não renumerar IDs, não remover entradas existentes — a dedup do bot depende dos IDs serem estáveis. Só adicionar com `id = max+1`.
- `data/state.json` é escrito pelo bot em cada execução e commitado pelo Action. Se você editar local, cuidado com conflitos.
- Rodar `MOCK_MODE=true` grava IDs `MOCK_<timestamp>` em `state.json` — **não commitar** esses mocks, a Action em prod não vai conseguir resolver esses tweets.
- **Painel local só pra mim:** existe um `panel/` no workspace local do usuário (Express + vanilla JS) pra curadoria. Está no `.gitignore` e **não deve ser commitado** — o usuário quer manter fora do GitHub por segurança. `start.js` faz `require` do painel dentro de try/catch exatamente por isso.
