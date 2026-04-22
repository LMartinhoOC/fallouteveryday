#!/usr/bin/env node
/**
 * lint-quotes.js
 *
 * Percorre data/quotes.json e sinaliza quotes com conteúdo fora do padrão:
 * stage directions ([Crying], *sighs*), skill checks ([SUCCEEDED]),
 * placeholders (<PlayerName>), markup residual ({{template}}, [[link]], ''italic''),
 * entidades HTML (&quot;), pipes/tabs de wikitext, quotes muito curtas, etc.
 *
 * Uso:
 *   node scripts/lint-quotes.js                    # resumo + 10 exemplos por regra
 *   node scripts/lint-quotes.js --all              # todos os matches (pode ser longo)
 *   node scripts/lint-quotes.js --rule bracket-tag # só uma regra
 *   node scripts/lint-quotes.js --out report.json  # salva JSON completo
 *   node scripts/lint-quotes.js --ids              # imprime só os IDs (um por linha), pra pipe
 *
 * O script NÃO modifica quotes.json. Sinaliza só — fix é manual.
 */

const fs   = require('fs');
const path = require('path');

const QUOTES_FILE = path.join(__dirname, '../data/quotes.json');

// ---------------------------------------------------------------------------
// Regras
// ---------------------------------------------------------------------------
// Cada regra: { name, description, regex?, test?, severity }
// regex: se matcha no texto, flag. test: função custom(quote) => boolean.
// ---------------------------------------------------------------------------

const RULES = [
  {
    name: 'skill-check',
    description: 'Marcador de skill check (Fallout-specific)',
    regex: /\[(?:SUCCEEDED|FAILED|Speech|Barter|Science|Medicine|Survival|Lockpick|Explosives|Guns|Energy|Melee|Unarmed|Sneak|Steal|Throwing|Outdoorsman|Repair|Intelligence|Perception|Charisma|Strength|Luck|Endurance|Agility)[^\]]*\]/i,
    severity: 'high',
  },
  {
    name: 'bracket-tag',
    description: 'Tag entre colchetes (emoção, ação, contexto) — ex: [Crying], [Whispers]',
    regex: /\[[^\]]{1,80}\]/,
    severity: 'high',
  },
  {
    name: 'curly-stage',
    description: 'Tag entre chaves — ex: {angry}, {laughs}',
    regex: /\{[^}]{1,80}\}/,
    severity: 'high',
  },
  {
    name: 'asterisk-action',
    description: 'Ação entre asteriscos — ex: *sighs*, *looks away*',
    regex: /\*[^*\n]{2,60}\*/,
    severity: 'high',
  },
  {
    name: 'angle-placeholder',
    description: 'Placeholder em <>, ex: <PlayerName>, <Alias:Foo>',
    regex: /<[A-Za-z][^>\n]{0,60}>/,
    severity: 'high',
  },
  {
    name: 'wiki-link',
    description: 'Link estilo wiki — [[Algo]]',
    regex: /\[\[[^\]]+\]\]/,
    severity: 'high',
  },
  {
    name: 'wiki-template',
    description: 'Template MediaWiki — {{Algo}}',
    regex: /\{\{[^}]+\}\}/,
    severity: 'high',
  },
  {
    name: 'wiki-bold-italic',
    description: "Markup de negrito/itálico — ''...'' ou '''...'''",
    regex: /'{2,5}[^'\n]/,
    severity: 'medium',
  },
  {
    name: 'html-entity',
    description: 'Entidade HTML não-decodificada — &quot;, &amp;, &#39;',
    regex: /&(?:[a-z]{2,8}|#\d{1,5});/i,
    severity: 'medium',
  },
  {
    name: 'pipe-or-tab',
    description: 'Pipe ou tab (leak de wikitext)',
    regex: /[|\t]/,
    severity: 'high',
  },
  {
    name: 'paren-stage',
    description: 'Parêntese curto com palavra em minúsculo (prov. stage direction) — ex: (laughs), (whispering)',
    regex: /\((?:[a-z]+(?:[\s,]+[a-z]+){0,3})\)/,
    severity: 'medium',
  },
  {
    name: 'speaker-label',
    description: 'Prefixo tipo "Nome:" no início (parece label de diálogo)',
    regex: /^[A-Z][a-zA-Z]{1,24}:\s/,
    severity: 'low',
  },
  {
    name: 'all-caps',
    description: 'Quote 100% em maiúsculas (provavelmente label, não diálogo)',
    test: q => {
      const s = q.quote.trim();
      return s.length >= 10 && s === s.toUpperCase() && /[A-Z]/.test(s);
    },
    severity: 'low',
  },
  {
    name: 'too-short',
    description: 'Quote muito curta (< 15 caracteres)',
    test: q => q.quote.trim().length < 15,
    severity: 'low',
  },
  {
    name: 'too-long',
    description: 'Quote muito longa (> 280 chars — não cabe em tweet)',
    test: q => q.quote.length > 280,
    severity: 'medium',
  },
  {
    name: 'non-printable',
    description: 'Caractere de controle / não-imprimível',
    regex: /[\x00-\x08\x0B-\x1F\x7F]/,
    severity: 'high',
  },
  {
    name: 'story-event-id',
    description: 'Identificador técnico do jogo (não é fala) — ex: VStoryEventXxx set to N.',
    regex: /\bV[A-Z][A-Za-z]+\s+set\s+to\s+-?\d+/,
    severity: 'high',
    deletable: true,
  },
];

// ---------------------------------------------------------------------------
// Auto-fixers (bulk fix por regra)
// ---------------------------------------------------------------------------
// Cada fixer recebe a string da quote e retorna a string corrigida.
// Se o fixer não conseguir aplicar (ex: regra sem fixer), retorna null.
// Convenção: remover o marcador + normalizar whitespace + limpar pontuação
// pendurada no início.
// ---------------------------------------------------------------------------

function cleanupAfterStrip(text) {
  // normaliza whitespace (incluindo whitespace deixado pelo strip)
  let s = text.replace(/\s+/g, ' ').trim();
  // remove pontuação/ws residual no começo (comum após stripar um marcador inicial)
  s = s.replace(/^[,;:\s]+/, '').trim();
  return s;
}

function stripByRegex(text, regex) {
  // aplica a regex globalmente (a regex original é sem /g)
  const flags = regex.flags.includes('g') ? regex.flags : regex.flags + 'g';
  const global = new RegExp(regex.source, flags);
  return cleanupAfterStrip(text.replace(global, ' '));
}

const HTML_ENTITIES = {
  '&quot;': '"', '&amp;': '&', '&#39;': "'", '&apos;': "'",
  '&lt;': '<', '&gt;': '>', '&nbsp;': ' ', '&mdash;': '—', '&ndash;': '–', '&hellip;': '…',
};

const FIXERS = {
  'skill-check':      (q, rule) => stripByRegex(q, rule.regex),
  'bracket-tag':      (q, rule) => stripByRegex(q, rule.regex),
  'curly-stage':      (q, rule) => stripByRegex(q, rule.regex),
  'asterisk-action':  (q, rule) => stripByRegex(q, rule.regex),
  'angle-placeholder':(q, rule) => stripByRegex(q, rule.regex),
  'wiki-link':        (q) => {
    // [[Foo|Bar]] → Bar, [[Foo]] → Foo
    return cleanupAfterStrip(q.replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, '$2')
                              .replace(/\[\[([^\]]+)\]\]/g, '$1'));
  },
  'wiki-template':    (q, rule) => stripByRegex(q, rule.regex),
  'wiki-bold-italic': (q) => {
    // ''''' (5 aspas = bold+italic), ''' (bold), '' (italic)
    return cleanupAfterStrip(q.replace(/'{5}([^']+?)'{5}/g, '$1')
                              .replace(/'{3}([^']+?)'{3}/g, '$1')
                              .replace(/'{2}([^']+?)'{2}/g, '$1'));
  },
  'html-entity':      (q) => {
    let s = q;
    for (const [entity, ch] of Object.entries(HTML_ENTITIES)) {
      s = s.split(entity).join(ch);
    }
    // numeric entities &#NNN;
    s = s.replace(/&#(\d{1,5});/g, (_, n) => {
      const code = parseInt(n, 10);
      return (code >= 32 && code < 0x10000) ? String.fromCharCode(code) : '';
    });
    return cleanupAfterStrip(s);
  },
  'pipe-or-tab':      (q) => {
    // Pipes em quotes do Fandom são sempre lixo de wikitext — corta no primeiro pipe/tab
    // Tabs também indicam leak, cortar tudo a partir dali
    const cut = q.split(/[|\t]/)[0];
    return cleanupAfterStrip(cut);
  },
  'paren-stage':      (q, rule) => stripByRegex(q, rule.regex),
  'non-printable':    (q) => cleanupAfterStrip(q.replace(/[\x00-\x08\x0B-\x1F\x7F]/g, ' ')),
  // Sem fixer automático:
  //   speaker-label → pode ser robô legítimo ("Warning:" do Protectron)
  //   all-caps       → idem
  //   too-short      → não tem como "consertar", só deletar manualmente
  //   too-long       → precisa split humano
};

// Aplica o fixer duma regra a todas as quotes que matcham.
// Retorna { updates: [{id, before, after}], tooShort: [{id, before, after}], skipped: [{id, before, reason}] }
// updates  → aplicar
// tooShort → resultado < MIN_LEN chars, não aplicado (revisar manualmente)
// skipped  → fixer não mudou nada ou não há fixer
const MIN_AUTOFIX_LEN = 10;

function autoFix(quotes, ruleName) {
  const rule  = RULES.find(r => r.name === ruleName);
  const fixer = FIXERS[ruleName];
  const result = { updates: [], tooShort: [], skipped: [], rule: ruleName };
  if (!rule)  { result.error = 'Regra desconhecida'; return result; }
  if (!fixer) { result.error = 'Sem fixer automático para essa regra'; return result; }

  for (const q of quotes) {
    if (runRule(rule, q) === null) continue;
    const before = q.quote;
    const after  = fixer(before, rule);

    if (after === before) {
      result.skipped.push({ id: q.id, before, reason: 'unchanged' });
    } else if (!after || after.trim().length < MIN_AUTOFIX_LEN) {
      result.tooShort.push({ id: q.id, before, after });
    } else {
      result.updates.push({ id: q.id, before, after });
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// Engine
// ---------------------------------------------------------------------------

function runRule(rule, quote) {
  if (rule.regex) {
    const m = quote.quote.match(rule.regex);
    return m ? m[0] : null;
  }
  if (rule.test) {
    return rule.test(quote) ? '(match)' : null;
  }
  return null;
}

// ---------------------------------------------------------------------------
// API programática (usada pelo painel local)
// ---------------------------------------------------------------------------
// runLint(quotes, { ruleName? }) → { totalFlagged, rules: [{name, description, severity, count}] }
// findingsForRule(quotes, ruleName) → [{ id, quote, character, game, match }]
// ---------------------------------------------------------------------------

function runLint(quotes, { ruleName = null } = {}) {
  const activeRules = ruleName ? RULES.filter(r => r.name === ruleName) : RULES;
  const totals      = {};
  const flaggedIds  = new Set();

  for (const r of activeRules) totals[r.name] = 0;

  for (const q of quotes) {
    for (const rule of activeRules) {
      if (runRule(rule, q) !== null) {
        totals[rule.name]++;
        flaggedIds.add(q.id);
      }
    }
  }

  const rules = activeRules.map(r => ({
    name:        r.name,
    description: r.description,
    severity:    r.severity,
    count:       totals[r.name],
  }));

  return { totalFlagged: flaggedIds.size, rules };
}

function findingsForRule(quotes, ruleName) {
  const rule = RULES.find(r => r.name === ruleName);
  if (!rule) return [];

  const out = [];
  for (const q of quotes) {
    const match = runRule(rule, q);
    if (match !== null) {
      out.push({
        id:        q.id,
        quote:     q.quote,
        character: q.character,
        game:      q.game,
        match,
      });
    }
  }
  return out;
}

module.exports = { RULES, FIXERS, runRule, runLint, findingsForRule, autoFix };

function main() {
  const args = process.argv.slice(2);
  const all      = args.includes('--all');
  const idsOnly  = args.includes('--ids');
  const outIdx   = args.indexOf('--out');
  const outFile  = outIdx !== -1 ? args[outIdx + 1] : null;
  const ruleIdx  = args.indexOf('--rule');
  const onlyRule = ruleIdx !== -1 ? args[ruleIdx + 1] : null;

  const data   = JSON.parse(fs.readFileSync(QUOTES_FILE, 'utf8'));
  const quotes = data.quotes;

  const activeRules = onlyRule
    ? RULES.filter(r => r.name === onlyRule)
    : RULES;

  if (onlyRule && activeRules.length === 0) {
    process.stderr.write(`Regra desconhecida: ${onlyRule}\n`);
    process.stderr.write(`Disponíveis: ${RULES.map(r => r.name).join(', ')}\n`);
    process.exit(1);
  }

  const findings = {}; // rule name → array of { id, quote, character, game, match }
  for (const r of activeRules) findings[r.name] = [];

  for (const q of quotes) {
    for (const rule of activeRules) {
      const match = runRule(rule, q);
      if (match !== null) {
        findings[rule.name].push({
          id: q.id,
          quote: q.quote,
          character: q.character,
          game: q.game,
          match,
        });
      }
    }
  }

  // Modo --ids: só lista IDs únicos com alguma flag, um por linha
  if (idsOnly) {
    const ids = new Set();
    for (const list of Object.values(findings)) for (const f of list) ids.add(f.id);
    [...ids].sort((a, b) => a - b).forEach(id => process.stdout.write(id + '\n'));
    return;
  }

  // Modo --out: salva JSON completo
  if (outFile) {
    const report = {
      timestamp: new Date().toISOString(),
      totalQuotes: quotes.length,
      totals: Object.fromEntries(
        Object.entries(findings).map(([name, list]) => [name, list.length])
      ),
      findings,
    };
    fs.writeFileSync(outFile, JSON.stringify(report, null, 2));
    process.stderr.write(`Report salvo: ${outFile}\n`);
    return;
  }

  // Modo padrão: texto humano-legível
  const w = s => process.stdout.write(s);
  const n = x => x.toLocaleString('pt-BR').padStart(6);

  w('\n=== LINT DE QUOTES ===\n');
  w(`Total no banco: ${quotes.length.toLocaleString('pt-BR')}\n\n`);

  const sortedRules = activeRules
    .slice()
    .sort((a, b) => findings[b.name].length - findings[a.name].length);

  // Resumo
  w('Resumo:\n');
  for (const r of sortedRules) {
    const count = findings[r.name].length;
    const sev   = { high: '🔴', medium: '🟡', low: '🔵' }[r.severity] || '  ';
    w(`  ${sev} ${n(count)}  ${r.name.padEnd(22)} ${r.description}\n`);
  }
  w('\n');

  // Detalhes
  const limit = all ? Infinity : 10;
  for (const r of sortedRules) {
    const list = findings[r.name];
    if (list.length === 0) continue;

    w(`── ${r.name} (${list.length}) ───────────────────────────────\n`);
    const shown = list.slice(0, limit);
    for (const f of shown) {
      const preview = f.quote.length > 140 ? f.quote.slice(0, 137) + '…' : f.quote;
      w(`  [#${f.id}] ${f.character} / ${f.game}\n`);
      w(`    match: ${JSON.stringify(f.match)}\n`);
      w(`    quote: ${preview}\n`);
    }
    if (list.length > shown.length) {
      w(`    … +${list.length - shown.length} mais (use --all ou --rule ${r.name})\n`);
    }
    w('\n');
  }

  // Totais
  const totalFlagged = new Set();
  for (const list of Object.values(findings)) for (const f of list) totalFlagged.add(f.id);
  w(`Total de quotes com pelo menos 1 flag: ${totalFlagged.size.toLocaleString('pt-BR')} de ${quotes.length.toLocaleString('pt-BR')}\n`);
}

if (require.main === module) {
  try {
    main();
  } catch (err) {
    process.stderr.write(`Erro: ${err.message}\n`);
    process.exit(1);
  }
}
