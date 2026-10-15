// Gerador do site Vou pra Missa.
//
//   node build.mjs            -> gera a pasta dist/ (versão para publicar)
//   node build.mjs --preview  -> gera dist-preview/ (abre direto no computador, sem servidor)
//
// Lê os dados de dados/*.csv e dados/*.json e gera páginas HTML estáticas.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  esc, slugify, sim, parseCSV, parseDias, labelDias, jsDia, DIAS,
  parseFaixa, fmtFaixa, hhmm, fmtData, parseLista, parseClero, ehUrl, fmtDataCurta, idadeDias
} from './build/lib.mjs';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const PREVIEW = args.includes('--preview');
const outArg = args.find((a) => a.startsWith('--out='));
const OUT = path.resolve(ROOT, outArg ? outArg.slice(6) : PREVIEW ? 'dist-preview' : 'dist');

const readJSON = (p) => JSON.parse(fs.readFileSync(path.join(ROOT, p), 'utf8'));
async function readSource(src) {
  if (/^https?:\/\//.test(src)) {
    const r = await fetch(src);
    if (!r.ok) throw new Error(`Não consegui baixar ${src} (código ${r.status})`);
    return await r.text();
  }
  return fs.readFileSync(path.join(ROOT, src), 'utf8');
}

const avisos = [];
const warn = (m) => avisos.push(m);

/* =====================================================================
   1. Carregar e validar os dados
   ===================================================================== */
const cfg = readJSON('dados/config.json');
const geo = readJSON('dados/regioes.json');
const banners = readJSON('dados/banners.json');

const estados = {};
for (const m of geo.macro) {
  for (const uf of m.estados) {
    const e = geo.estados[uf];
    if (!e) { warn(`regioes.json: estado ${uf} listado em "${m.nome}" mas sem definição.`); continue; }
    estados[uf] = { uf, nome: e.nome, macro: m.nome, regioes: e.regioes.map((n) => ({ nome: n, slug: slugify(n) })) };
  }
}

const rowsI = parseCSV(await readSource(cfg.fontes.igrejas));
const rowsH = parseCSV(await readSource(cfg.fontes.horarios));

const ids = new Set();
const slugs = new Set();
const igrejas = [];
for (const r of rowsI) {
  if (!r.id || !r.nome) { warn(`igrejas.csv: linha sem "id" ou "nome" ignorada (${JSON.stringify(r).slice(0, 70)}...)`); continue; }
  if (ids.has(r.id)) { warn(`igrejas.csv: id repetido "${r.id}" — a segunda linha foi ignorada.`); continue; }
  const uf = (r.uf || '').toUpperCase();
  if (!estados[uf]) { warn(`igrejas.csv: "${r.nome}" tem UF "${r.uf}" desconhecida — linha ignorada.`); continue; }
  ids.add(r.id);
  const reg = estados[uf].regioes.find((x) => slugify(x.nome) === slugify(r.regiao));
  if (!reg) warn(`igrejas.csv: "${r.nome}" (${r.id}) usa a região "${r.regiao}", que não existe em ${uf}. Confira dados/regioes.json.`);
  let slug = slugify(`${r.nome}-${r.bairro}`);
  if (slugs.has(slug)) slug += '-' + slugify(r.id);
  slugs.add(slug);
  igrejas.push({
    ...r, uf, slug,
    regiaoSlug: reg ? reg.slug : slugify(r.regiao),
    regiaoNome: reg ? reg.nome : r.regiao,
    dioceseSlug: slugify(r.diocese),
    destaque: sim(r.destaque),
    exemplo: sim(r.exemplo),
    fotos: parseLista(r.fotos),
    clero: parseClero(r.clero),
    horarios: { missa: [], confissao: [], secretaria: [], adoracao: [] }
  });
}
const porId = Object.fromEntries(igrejas.map((c) => [c.id, c]));

const TIPOS_HOR = { missa: 'Missas', confissao: 'Confissões', secretaria: 'Secretaria', adoracao: 'Adoração' };
for (const h of rowsH) {
  const c = porId[h.id_igreja];
  const ref = `horarios.csv (${h.id_igreja} · ${h.tipo} · ${h.dias} · ${h.hora})`;
  if (!c) { warn(`${ref}: não existe igreja com esse id em igrejas.csv.`); continue; }
  const tipo = slugify(h.tipo || 'missa').replace(/^confissoes$/, 'confissao').replace(/^missas$/, 'missa');
  if (!TIPOS_HOR[tipo]) { warn(`${ref}: tipo desconhecido (use missa, confissao, secretaria ou adoracao).`); continue; }
  const dias = parseDias(h.dias);
  if (!dias.length) { warn(`${ref}: não entendi os dias "${h.dias}" (exemplos: seg-sex, dom, ter,qui).`); continue; }
  const faixa = parseFaixa(h.hora);
  if (!faixa) { warn(`${ref}: não entendi a hora "${h.hora}" (exemplos: 19:30 ou 16:00-18:00).`); continue; }
  c.horarios[tipo].push({ dias, faixa, obs: h.obs || '' });
}
for (const c of igrejas) {
  c.capa = c.foto || c.fotos[0] || '';
  for (const f of [...new Set([c.foto, ...c.fotos].filter(Boolean))]) {
    if (ehUrl(f)) continue;
    const arq = path.join(ROOT, f);
    if (!fs.existsSync(arq)) { warn(`"${c.nome}" (${c.id}): a foto "${f}" não foi encontrada. Confira o nome e se o arquivo foi enviado.`); continue; }
    const kb = Math.round(fs.statSync(arq).size / 1024);
    if (kb > 600) warn(`"${c.nome}" (${c.id}): a foto "${f}" tem ${kb} KB. Reduza para até ~300 KB para o site abrir rápido no celular.`);
  }
  if (!c.exemplo) {
    const dias = idadeDias(c.confirmado_em);
    if (dias == null) warn(`"${c.nome}" (${c.id}): sem data em "confirmado_em" — o site mostrará "horário a confirmar".`);
    else if (dias > 90) warn(`"${c.nome}" (${c.id}): horários confirmados há ${dias} dias. Vale pedir reconfirmação à paróquia.`);
  }
  if (!c.horarios.missa.length) warn(`"${c.nome}" (${c.id}) ainda não tem horários de missa.`);
  c.tokens = [...new Set(c.horarios.missa.flatMap((m) => m.dias.map((d) => `${jsDia(d)}@${hhmm(m.faixa.a)}`)))].join(' ');
}

/* Índices */
const ativosUF = new Set(igrejas.map((c) => c.uf));
const regAtivas = {};
const diocesesPorUf = {};
for (const c of igrejas) {
  (regAtivas[c.uf] ??= new Set()).add(c.regiaoSlug);
  const lista = (diocesesPorUf[c.uf] ??= new Map());
  if (c.diocese) lista.set(c.dioceseSlug, { nome: c.diocese, slug: c.dioceseSlug });
}
const dioceses = new Map();
for (const c of igrejas) if (c.diocese) dioceses.set(c.dioceseSlug, { nome: c.diocese, slug: c.dioceseSlug, uf: c.uf });
const ordenar = (lista) =>
  [...lista].sort((a, b) =>
    (b.destaque ? 1 : 0) - (a.destaque ? 1 : 0) ||
    a.cidade.localeCompare(b.cidade, 'pt-BR') ||
    a.bairro.localeCompare(b.bairro, 'pt-BR') ||
    a.nome.localeCompare(b.nome, 'pt-BR'));

/* =====================================================================
   2. Peças de HTML
   ===================================================================== */
let CTX;
function mkctx(depth, abs) {
  if (abs != null) return { root: abs, a: (p) => abs + p, u: (p = '') => abs + p };
  const root = depth ? '../'.repeat(depth) : './';
  return {
    root,
    a: (p) => root + p,
    u: (p = '') => root + p + (PREVIEW && (p === '' || p.endsWith('/')) ? 'index.html' : '')
  };
}

const svgPin = (size, pin, igreja) =>
  `<svg viewBox="0 0 64 64" width="${size}" height="${size}" aria-hidden="true"><path d="M32 3C18.7 3 8 13.4 8 26.4C8 43 27 57.5 32 62C37 57.5 56 43 56 26.4C56 13.4 45.3 3 32 3Z" fill="${pin}"/><path d="M21 32L32 22.5L43 32V45H21Z" fill="${igreja}"/><path d="M29 45V39.5a3 3 0 0 1 6 0V45Z" fill="#C9A24B"/><rect x="31.1" y="10.5" width="1.8" height="11" fill="#C9A24B"/><rect x="28.4" y="13.4" width="7.2" height="1.8" fill="#C9A24B"/></svg>`;
const svgIgreja = (size) =>
  `<svg viewBox="0 0 64 64" width="${size}" height="${size}" aria-hidden="true"><path d="M21 32L32 22.5L43 32V45H21Z" fill="#FBF7EE"/><path d="M29 45V39.5a3 3 0 0 1 6 0V45Z" fill="#C9A24B"/><rect x="31.1" y="10.5" width="1.8" height="11" fill="#C9A24B"/><rect x="28.4" y="13.4" width="7.2" height="1.8" fill="#C9A24B"/></svg>`;
const svgCruz = (size, cor = '#FBF7EE') =>
  `<svg viewBox="0 0 24 24" width="${size}" height="${size}" aria-hidden="true"><rect x="10.8" y="2" width="2.4" height="20" rx="1" fill="${cor}"/><rect x="5" y="7.5" width="14" height="2.4" rx="1" fill="${cor}"/></svg>`;
const ICON = {
  chevron: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>',
  search: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="#5A6478" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/></svg>',
  pin: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="#5A6478" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/></svg>',
  phone: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="#5A6478" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A15 15 0 0 1 3 6a2 2 0 0 1 2-2z"/></svg>',
  globe: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="#5A6478" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/></svg>',
  mail: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="#5A6478" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/></svg>',
  clock: '<svg viewBox="0 0 24 24" width="30" height="30" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
  clockSm: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
  check: '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
  heart: '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path class="heart" d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>',
  heartSm: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="#C9A24B" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>'
};

const fotoSrc = (p) => (ehUrl(p) ? p : CTX.a(String(p).replace(/^\/+/, '')));

/* Selo de confirmação dos horários. curto=true nos cartões, completo na página da igreja. */
function seloConfirmacao(c, curto = false) {
  const iso = c.confirmado_em;
  const dias = idadeDias(iso);
  if (dias == null) {
    return `<span class="badge-pend" title="A paróquia ainda não confirmou os horários">${ICON.clockSm}${curto ? 'a confirmar' : 'Horário ainda não confirmado pela paróquia'}</span>`;
  }
  if (dias > 120) {
    return `<span class="badge-velho" title="Confirmado em ${fmtData(iso)}. Pode estar desatualizado.">${ICON.clockSm}${curto ? `confirmado em ${fmtDataCurta(iso)}` : `Horário confirmado em ${fmtData(iso)} · reconfirmar com a paróquia`}</span>`;
  }
  return `<span class="badge-ok">${ICON.check}${curto ? `confirmado em ${fmtDataCurta(iso)}` : `Horário confirmado em ${fmtData(iso)}`}</span>`;
}

const wa = (msg) => `https://wa.me/${cfg.whatsapp}?text=${encodeURIComponent(msg)}`;
const TIPO_LABEL = { catedral: 'Catedral', paroquia: 'Paróquia', capela: 'Capela', santuario: 'Santuário', comunidade: 'Comunidade', mosteiro: 'Mosteiro', 'area-pastoral': 'Área pastoral' };
const tipoLabel = (c) => TIPO_LABEL[slugify(c.tipo)] || 'Igreja';
const plural = (n, a, b) => `${n} ${n === 1 ? a : b}`;

function banner(pos) {
  const b = banners[pos];
  if (!b) return '';
  if (b.img) {
    return `<a class="ad ad-${pos}" href="${esc(b.link || '#')}" target="_blank" rel="sponsored noopener"><span class="ad-tag">publicidade</span><img src="${esc(CTX.a(b.img))}" alt="${esc(b.alt || 'Publicidade')}" loading="lazy"></a>`;
  }
  return `<a class="ad vazio ad-${pos}" href="${esc(CTX.u('anuncie/'))}"><span class="ad-tag">publicidade</span><b>Anuncie aqui</b><small>${esc(b.tamanho)} px</small></a>`;
}

function menuHtml(ufAtual) {
  const macroAtual = ufAtual && estados[ufAtual] ? estados[ufAtual].macro : geo.macro[0].nome;
  const tabs = geo.macro.map((m) =>
    `<li><button type="button" role="tab" data-macro="${slugify(m.nome)}" aria-selected="${m.nome === macroAtual}">${esc(m.nome)}</button></li>`).join('');
  const panels = geo.macro.map((m) => {
    const cols = m.estados.filter((uf) => estados[uf]).map((uf) => {
      const e = estados[uf];
      if (!ativosUF.has(uf)) {
        return `<div class="mm-estado"><h3 class="soon">${esc(e.nome)}<small>em breve</small></h3></div>`;
      }
      const regs = e.regioes.map((r) => regAtivas[uf].has(r.slug)
        ? `<li><a href="${CTX.u(`${uf.toLowerCase()}/${r.slug}/`)}">${esc(r.nome)}</a></li>`
        : `<li><span class="soon" title="Em breve">${esc(r.nome)}</span></li>`).join('');
      return `<div class="mm-estado"><h3><a href="${CTX.u(uf.toLowerCase() + '/')}">${esc(e.nome)}</a></h3><ul>${regs}</ul></div>`;
    }).join('');
    return `<div class="mm-panel" role="tabpanel" data-macro="${slugify(m.nome)}"${m.nome === macroAtual ? '' : ' hidden'}><div class="mm-cols">${cols}</div></div>`;
  }).join('');
  return `<div class="mm" id="mm" hidden><div class="mm-box"><div class="mm-card"><ul class="mm-macros" role="tablist" aria-label="Macrorregiões">${tabs}</ul><div class="mm-panels">${panels}</div></div></div></div>`;
}

function buscaHtml(id, placeholder) {
  return `<form class="busca js-busca" role="search" action="#"><label class="sr-only" for="${id}">Buscar igreja, bairro ou diocese</label>${ICON.search}<input id="${id}" type="search" autocomplete="off" placeholder="${esc(placeholder)}"><ul class="busca-res" hidden></ul></form>`;
}

function header(ufAtual, opts = {}) {
  const label = ufAtual && estados[ufAtual] ? estados[ufAtual].nome : 'Escolha a região';
  const proto = cfg.lancado ? '' : `<div class="proto-bar">Versão de testes · os dados desta versão são de exemplo e não devem ser usados para ir à missa</div>`;
  return `${proto}<header class="hdr"><div class="hdr-in">
<a class="logo" href="${CTX.u('')}" aria-label="${esc(cfg.nome)}, página inicial">${svgPin(40, '#FBF7EE', '#17305E')}<span class="wordmark">Vou <em>pra</em> Missa</span></a>
<button type="button" class="mm-btn" id="mm-btn" aria-expanded="false" aria-controls="mm">${esc(label)}${ICON.chevron}</button>
${opts.semBusca ? '' : buscaHtml('q-topo', 'Digite o nome da igreja, bairro ou diocese')}
<nav aria-label="Principal"><a class="lista-link" href="${CTX.u('minha-lista/')}">${ICON.heartSm}<span>Minha lista (<span class="js-lista-count">0</span>)</span></a><a class="btn-ouro" href="${CTX.u('cadastre-sua-paroquia/')}">Cadastre sua paróquia</a></nav>
</div>${menuHtml(ufAtual)}</header>`;
}

function footer() {
  return `<footer class="ftr"><div class="ftr-in"><div class="ftr-top">
<div><span class="wordmark">Vou <em>pra</em> Missa</span><p>${esc(cfg.slogan)}: horários, endereços e notícias das paróquias.</p></div>
<div class="ftr-cols">
<div><b>Para paróquias</b><a href="${CTX.u('cadastre-sua-paroquia/')}">Cadastre sua paróquia</a><a href="${CTX.u('cadastre-sua-paroquia/')}">Atualizar horários</a></div>
<div><b>Anuncie</b><a href="${CTX.u('anuncie/')}">Espaços e preços</a><a href="${esc(wa('Olá! Quero falar sobre o Vou pra Missa.'))}">Fale conosco</a></div>
<div><b>Site</b><a href="${CTX.u('sobre/')}">Sobre o projeto</a><a href="${CTX.u('privacidade/')}">Privacidade</a><a href="${esc(cfg.instagram)}" rel="noopener">Instagram</a></div>
</div></div>
<div class="ftr-fim">Projeto independente, sem vínculo oficial com a Igreja Católica ou com qualquer diocese. Os horários podem mudar: confirme com a paróquia. © ${new Date().getFullYear()} ${esc(cfg.nome)}.</div>
</div></footer>`;
}

function layout({ title, desc, canonical, noindex, body, jsonld, uf, semBusca }) {
  const full = title ? `${title} | ${cfg.nome}` : `${cfg.nome} — ${cfg.slogan}`;
  const bloquear = noindex || !cfg.lancado;
  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(full)}</title>
<meta name="description" content="${esc(desc || cfg.slogan)}">
${bloquear ? '<meta name="robots" content="noindex, nofollow">' : ''}
${canonical != null ? `<link rel="canonical" href="${esc(cfg.siteUrl + canonical)}">` : ''}
<meta property="og:type" content="website">
<meta property="og:locale" content="pt_BR">
<meta property="og:site_name" content="${esc(cfg.nome)}">
<meta property="og:title" content="${esc(full)}">
<meta property="og:description" content="${esc(desc || cfg.slogan)}">
<meta name="theme-color" content="#17305E">
<link rel="icon" href="${CTX.a('assets/favicon.svg')}" type="image/svg+xml">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,500;0,9..144,600;0,9..144,700;1,9..144,500&amp;family=Figtree:wght@400;500;600;700&amp;display=swap">
<link rel="stylesheet" href="${CTX.a('assets/style.css')}">
${jsonld ? `<script type="application/ld+json">${JSON.stringify(jsonld).replace(/</g, '\\u003c')}</script>` : ''}
</head>
<body data-root="${esc(CTX.root)}" data-preview="${PREVIEW ? 1 : 0}">
${header(uf, { semBusca })}
<main>
${body}
</main>
${footer()}
<script src="${CTX.a('assets/app.js')}" defer></script>
</body>
</html>
`;
}

function cardHtml(c) {
  const selo = seloConfirmacao(c, true) + (c.exemplo ? '<span class="badge-ex">exemplo</span>' : '');
  return `<div class="card-wrap"><a class="card" href="${CTX.u(`igreja/${c.slug}/`)}">
<span class="card-top"><span class="avatar">${c.capa ? `<img src="${esc(fotoSrc(c.capa))}" alt="" loading="lazy">` : svgIgreja(32)}</span>
<span class="card-title"><span class="nome">${esc(c.nome)}</span><span class="sub">${esc(c.setor ? 'Setor ' + c.setor : c.diocese)}</span></span></span>
<span class="card-loc">${ICON.pin}${esc(c.bairro)} · ${esc(c.cidade)}</span>
<span class="card-badges"><span class="badge badge-prox js-proxima" data-missas="${esc(c.tokens)}">${ICON.clockSm}<span>Ver horários</span></span>${selo}</span>
<span class="card-links">horários &middot; confissões &middot; sobre &middot; como chegar</span>
</a><button type="button" class="save" data-id="${esc(c.id)}" data-nome="${esc(c.nome)}" aria-pressed="false" aria-label="Salvar na minha lista: ${esc(c.nome)}">${ICON.heart}</button></div>`;
}

function destaqueHtml(c) {
  return `<a class="destaque" href="${CTX.u(`igreja/${c.slug}/`)}">${c.capa ? `<img src="${esc(fotoSrc(c.capa))}" alt="" loading="lazy">` : svgCruz(170)}<span class="selo">Destaque</span><span class="leg"><b>${esc(c.nome)}</b><span>${esc(c.bairro)} · ${esc(c.setor ? 'Setor ' + c.setor : c.cidade)}</span></span></a>`;
}

/* =====================================================================
   3. Páginas
   ===================================================================== */
const paginas = []; // { rel, html, url?, indexar }

function emitir(rel, html, url, indexar = false) {
  paginas.push({ rel, html, url, indexar });
}

function paginaEntrada() {
  CTX = mkctx(0);
  const estadosHtml = geo.macro.flatMap((m) => m.estados).filter((uf) => estados[uf]).map((uf) => {
    const e = estados[uf];
    const ativo = ativosUF.has(uf);
    const n = igrejas.filter((c) => c.uf === uf).length;
    const regs = ativo
      ? e.regioes.filter((r) => regAtivas[uf].has(r.slug)).map((r) => `<a href="${CTX.u(`${uf.toLowerCase()}/${r.slug}/`)}">${esc(r.nome)}</a>`).join(' &middot; ')
      : '';
    return `<div class="estado${ativo ? '' : ' soon'}"><span class="estado-badge" aria-hidden="true">${uf}</span><div>
<h3>${ativo ? `<a href="${CTX.u(uf.toLowerCase() + '/')}">${esc(e.nome)}</a>` : esc(e.nome)}</h3>
<p>${ativo ? `${regs}<br>${plural(n, 'igreja', 'igrejas')}` : 'Em breve'}</p></div></div>`;
  }).join('');

  const dios = [...dioceses.values()].map((d) => {
    const n = igrejas.filter((c) => c.dioceseSlug === d.slug).length;
    return `<a class="chip" href="${CTX.u(`diocese/${d.slug}/`)}">${esc(d.nome)} (${n})</a>`;
  }).join(' ');

  const body = `
<section class="hero"><div class="wrap">
<h1>${esc(cfg.slogan)}</h1>
<p>Horários de missa, confissões e endereços das paróquias, sempre à mão.</p>
${buscaHtml('q-hero', 'Digite o nome da igreja, bairro ou diocese')}
</div></section>
<div class="wrap">
<section class="card-regiao"><h2>Escolha uma região</h2><div class="estados">${estadosHtml}</div></section>
<section class="bloco"><h2>Ou escolha pela diocese</h2><p>Cada diocese reúne as paróquias do seu território.</p><div class="linha-chips">${dios || '<span class="chip soon">Em breve</span>'}</div></section>
<section class="bloco"><h2>A sua paróquia ainda não está aqui?</h2><p>O cadastro é gratuito. Envie os horários e o endereço e a sua comunidade passa a aparecer para quem procura missa na região.</p><a class="btn-ouro link" style="display:inline-block" href="${CTX.u('cadastre-sua-paroquia/')}">Cadastre sua paróquia</a></section>
<div style="margin-top:22px">${banner('rodape')}</div>
</div>`;
  emitir('index.html', layout({
    title: '', desc: `${cfg.slogan}. Horários de missa, confissões e endereços das igrejas católicas por estado, região e diocese.`,
    canonical: '/', body, semBusca: true
  }), '/', true);
}

function listagem({ depth, rel, uf, kicker, h1, crumbs, lista, regSel, dioSel, title, desc, canonicalPath }) {
  CTX = mkctx(depth);
  const e = estados[uf];
  const base = uf.toLowerCase();
  const chipsReg = [
    `<a class="chip${!regSel && !dioSel ? ' sel' : ''}" href="${CTX.u(base + '/')}">Todas</a>`,
    ...e.regioes.map((r) => regAtivas[uf]?.has(r.slug)
      ? `<a class="chip${regSel === r.slug ? ' sel' : ''}" href="${CTX.u(`${base}/${r.slug}/`)}">${esc(r.nome)}</a>`
      : `<span class="chip soon" title="Em breve">${esc(r.nome)}</span>`)
  ].join('');
  const dios = [...(diocesesPorUf[uf]?.values() || [])];
  const chipsDio = dios.length
    ? [`<a class="chip${!dioSel && !regSel ? ' sel' : ''}" href="${CTX.u(base + '/')}">Todas</a>`,
       ...dios.map((d) => `<a class="chip${dioSel === d.slug ? ' sel' : ''}" href="${CTX.u(`diocese/${d.slug}/`)}">${esc(d.nome)}</a>`)].join('')
    : '';

  const ordenada = ordenar(lista);
  const dest = ordenada.filter((c) => c.destaque).slice(0, 3);
  const cards = [];
  ordenada.forEach((c, i) => {
    if (i > 0 && i % 8 === 0) cards.push(`<div class="ad-linha">${banner('lista')}</div>`);
    cards.push(cardHtml(c));
  });
  if (ordenada.length < 8 || ordenada.length % 8 !== 0) cards.push(`<div class="ad-linha">${banner('lista')}</div>`);

  const body = `
<div class="faixa"><div class="faixa-in">
<div class="linha-chips"><span class="rot">Regiões</span>${chipsReg}</div>
${chipsDio ? `<div class="linha-chips"><span class="rot">Dioceses</span>${chipsDio}</div>` : ''}
</div></div>
<div class="conteudo">
<nav class="migalha" aria-label="Você está em">${crumbs}</nav>
<div><p class="kicker">${esc(kicker)}</p><h1 class="titulo">${esc(h1)}</h1></div>
${banner('topo')}
${dest.length ? `<section style="display:flex;flex-direction:column;gap:14px"><div class="sec-tit"><h2 class="sec">Destaques</h2></div><div class="destaques">${dest.map(destaqueHtml).join('')}</div></section>` : ''}
<div class="duas-col">
<section class="col-main"><div class="sec-tit"><h2 class="sec">Igrejas e horários</h2><span>${plural(ordenada.length, 'igreja', 'igrejas')}</span></div>
<div class="grid-cards">${cards.join('')}</div></section>
<aside class="col-side" aria-label="Publicidade">${banner('lateral1')}${banner('lateral2')}</aside>
</div>
${banner('rodape')}
</div>`;
  const exemplo = lista.every((c) => c.exemplo);
  emitir(rel, layout({ title, desc, canonical: canonicalPath, body, uf, noindex: exemplo }), canonicalPath, !exemplo);
}

const migalhaBase = () => `<a href="${CTX.u('')}">Início</a><span aria-hidden="true">›</span>`;

function paginasListagem() {
  for (const uf of ativosUF) {
    const e = estados[uf];
    const base = uf.toLowerCase();
    const doEstado = igrejas.filter((c) => c.uf === uf);
    // Estado
    CTX = mkctx(1);
    listagem({
      depth: 1, rel: `${base}/index.html`, uf, kicker: 'Igrejas e horários de missa em', h1: e.nome,
      crumbs: `${migalhaBase()}<span>${esc(e.nome)}</span>`, lista: doEstado,
      title: `Missas e igrejas em ${e.nome}`, desc: `Horários de missa, confissões e endereços das igrejas católicas em ${e.nome}.`,
      canonicalPath: `/${base}/`
    });
    // Regiões
    for (const r of e.regioes.filter((x) => regAtivas[uf].has(x.slug))) {
      const lista = doEstado.filter((c) => c.regiaoSlug === r.slug);
      CTX = mkctx(2);
      listagem({
        depth: 2, rel: `${base}/${r.slug}/index.html`, uf, regSel: r.slug, kicker: 'Igrejas e horários de missa em', h1: `${r.nome}, ${e.nome}`,
        crumbs: `${migalhaBase()}<a href="${CTX.u(base + '/')}">${esc(e.nome)}</a><span aria-hidden="true">›</span><span>${esc(r.nome)}</span>`,
        lista, title: `Missas na ${r.nome}, ${e.nome}`, desc: `Horários de missa e endereços de ${plural(lista.length, 'igreja', 'igrejas')} em ${r.nome}, ${e.nome}.`,
        canonicalPath: `/${base}/${r.slug}/`
      });
    }
  }
  // Dioceses
  for (const d of dioceses.values()) {
    const lista = igrejas.filter((c) => c.dioceseSlug === d.slug);
    const e = estados[d.uf];
    CTX = mkctx(2);
    listagem({
      depth: 2, rel: `diocese/${d.slug}/index.html`, uf: d.uf, dioSel: d.slug, kicker: 'Igrejas e horários de missa da', h1: d.nome,
      crumbs: `${migalhaBase()}<a href="${CTX.u(d.uf.toLowerCase() + '/')}">${esc(e.nome)}</a><span aria-hidden="true">›</span><span>${esc(d.nome)}</span>`,
      lista, title: `Missas e igrejas da ${d.nome}`, desc: `Horários de missa e endereços das paróquias da ${d.nome}.`,
      canonicalPath: `/diocese/${d.slug}/`
    });
  }
}

/* ---------- Página da igreja ---------- */
function agrupar(entradas) {
  const mapa = new Map();
  for (const x of entradas) {
    const k = x.dias.join(',');
    if (!mapa.has(k)) mapa.set(k, { dias: x.dias, itens: [] });
    mapa.get(k).itens.push(x);
  }
  const linhas = [...mapa.values()];
  linhas.sort((a, b) => DIAS.indexOf(a.dias[0]) - DIAS.indexOf(b.dias[0]) || b.dias.length - a.dias.length);
  linhas.forEach((l) => l.itens.sort((x, y) => x.faixa.a - y.faixa.a));
  return linhas;
}
const celula = (l) => l.itens.map((i) => `<span class="hora">${fmtFaixa(i.faixa)}${i.obs ? ` <small>${esc(i.obs)}</small>` : ''}</span>`).join('');
const linhaHtml = (l, extra = '') =>
  `<tr data-dias="${l.dias.map(jsDia).join(',')}"><th scope="row">${esc(labelDias(l.dias))}${extra ? `<small>${esc(extra)}</small>` : ''}</th><td>${celula(l)}</td></tr>`;

function paginaIgreja(c) {
  CTX = mkctx(2);
  const e = estados[c.uf];
  const base = c.uf.toLowerCase();
  const urlAbs = `${cfg.siteUrl}/igreja/${c.slug}/`;
  const consulta = c.endereco ? `${c.endereco}, ${c.cidade} - ${c.uf}` : `${c.nome}, ${c.bairro}, ${c.cidade} - ${c.uf}`;
  const mapaUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(consulta)}`;
  const wazeUrl = `https://waze.com/ul?q=${encodeURIComponent(consulta)}&navigate=yes`;
  const contatos = [
    `<li>${ICON.pin}<span>${esc(c.endereco || `${c.bairro}, ${c.cidade} - ${c.uf}`)}${c.endereco ? '' : ' <em style="color:#5A6478">(endereço completo em breve)</em>'} · <a href="${mapaUrl}" target="_blank" rel="noopener">ver no mapa</a></span></li>`,
    c.telefone ? `<li>${ICON.phone}<a href="tel:${esc(c.telefone.replace(/[^\d+]/g, ''))}">${esc(c.telefone)}</a></li>` : '',
    c.whatsapp ? `<li>${ICON.phone}<a href="https://wa.me/${esc(c.whatsapp.replace(/\D/g, ''))}" rel="noopener">WhatsApp da paróquia</a></li>` : '',
    c.email ? `<li>${ICON.mail}<a href="mailto:${esc(c.email)}">${esc(c.email)}</a></li>` : '',
    c.site ? `<li>${ICON.globe}<a href="${esc(c.site)}" target="_blank" rel="noopener">${esc(c.site.replace(/^https?:\/\//, ''))}</a></li>` : '',
    c.instagram ? `<li>${ICON.globe}<a href="${esc(c.instagram)}" target="_blank" rel="noopener">Instagram</a></li>` : ''
  ].join('');

  const selo = `<div class="selos">${seloConfirmacao(c)}${c.exemplo ? '<span class="badge-ex">dados de exemplo</span>' : ''}</div>`;

  /* Galeria de fotos */
  const fotos = [...new Set(c.fotos.length ? c.fotos : (c.foto ? [c.foto] : []))];
  const galeria = fotos.length
    ? `<section class="secao galeria" aria-label="Fotos da paróquia">
<div class="gal-stage"><img class="gal-main" src="${esc(fotoSrc(fotos[0]))}" alt="${esc(`Foto 1 de ${fotos.length} — ${c.nome}`)}" width="1200" height="750">
${fotos.length > 1 ? `<button type="button" class="gal-nav prev" aria-label="Foto anterior"><svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg></button><button type="button" class="gal-nav next" aria-label="Próxima foto"><svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 5l7 7-7 7"/></svg></button><span class="gal-count" aria-live="polite">1 / ${fotos.length}</span>` : ''}</div>
${fotos.length > 1 ? `<div class="gal-thumbs">${fotos.map((f, i) => `<a class="gal-thumb" href="${esc(fotoSrc(f))}" data-src="${esc(fotoSrc(f))}" data-alt="${esc(`Foto ${i + 1} de ${fotos.length} — ${c.nome}`)}" aria-label="Ver foto ${i + 1}" aria-current="${i === 0}"><img src="${esc(fotoSrc(f))}" alt="" loading="lazy" width="96" height="64"></a>`).join('')}</div>` : ''}
</section>`
    : `<section class="secao galeria vazia" aria-label="Fotos da paróquia"><div class="gal-stage gal-vazia">${svgCruz(190)}<div class="gal-vazia-txt"><b>Esta paróquia ainda não enviou fotos.</b><span>Se você faz parte dela, envie fotos da igreja para aparecerem aqui.</span><a class="btn-ouro" href="${CTX.u('cadastre-sua-paroquia/')}">Enviar fotos</a></div></div></section>`;

  /* Quem conduz a paróquia */
  const clero = c.clero.length
    ? `<h3 class="sub-tit">Quem conduz a paróquia</h3><ul class="clero">${c.clero.map((x) => `<li>${x.cargo ? `<span class="cargo">${esc(x.cargo)}</span>` : ''}<span class="nome-clero">${esc(x.nome)}</span></li>`).join('')}</ul>`
    : '';

  const missas = agrupar(c.horarios.missa);
  const outros = [];
  for (const t of ['confissao', 'secretaria', 'adoracao']) {
    for (const l of agrupar(c.horarios[t])) outros.push(linhaHtml(l, TIPOS_HOR[t]));
  }

  const paragrafos = (c.sobre || '').split(/\n+/).filter(Boolean);
  const sobre = paragrafos.length
    ? paragrafos.map((p) => `<p>${esc(p)}</p>`).join('')
    : `<p style="color:#5A6478">A paróquia ainda não enviou o texto de apresentação. Se você faz parte dela, <a class="link" style="color:#17305E;font-weight:600" href="${CTX.u('cadastre-sua-paroquia/')}">envie as informações</a>.</p>`;
  const pastorais = parseLista(c.pastorais);

  const perto = ordenar(igrejas.filter((x) => x.id !== c.id && x.uf === c.uf && (x.setor === c.setor || x.regiaoSlug === c.regiaoSlug)))
    .sort((a, b) => (b.setor === c.setor ? 1 : 0) - (a.setor === c.setor ? 1 : 0)).slice(0, 3);

  const body = `
<div class="conteudo">
<nav class="migalha" aria-label="Você está em">${migalhaBase()}<a href="${CTX.u(base + '/')}">${esc(e.nome)}</a><span aria-hidden="true">›</span><a href="${CTX.u(`${base}/${c.regiaoSlug}/`)}">${esc(c.regiaoNome)}</a><span aria-hidden="true">›</span><a href="${CTX.u(`diocese/${c.dioceseSlug}/`)}">${esc(c.diocese)}</a><span aria-hidden="true">›</span><span>${esc(c.nome)}</span></nav>
${c.exemplo ? '<div class="aviso-ex"><strong>Dados de exemplo.</strong> Nome, setor e bairro vêm da lista pública da diocese, mas endereço, telefone e horários desta página são ilustrativos e não devem ser usados.</div>' : ''}
<section class="ficha">
<div class="ficha-info"><span class="avatar">${c.capa ? `<img src="${esc(fotoSrc(c.capa))}" alt="">` : svgIgreja(54)}</span>
<div style="min-width:0;display:flex;flex-direction:column"><h1>${esc(c.nome)}</h1>
<div class="tipo">${esc(tipoLabel(c))}${c.setor ? ` · Setor ${esc(c.setor)}` : ''} · ${esc(c.diocese)}</div>
<ul class="contatos">${contatos}</ul>${selo}</div></div>
<div class="ficha-acoes">
<div class="proxbox js-proxima-box" data-missas="${esc(c.tokens)}">${ICON.clock}<div><div class="pb-label">Horários</div><div class="pb-time">a confirmar</div></div></div>
<a class="btn" href="${mapaUrl}" target="_blank" rel="noopener">Como chegar</a>
<button type="button" class="save btn save-big" data-id="${esc(c.id)}" data-nome="${esc(c.nome)}" aria-pressed="false">${ICON.heart}<span class="save-txt">Salvar na minha lista</span></button>
<a class="btn zap" href="https://wa.me/?text=${encodeURIComponent(`${c.nome} — horários de missa: ${urlAbs}`)}" target="_blank" rel="noopener">Compartilhar no WhatsApp</a>
</div></section>
<div class="duas-col"><div class="col-main" style="gap:20px">
${galeria}
<section class="secao"><div class="secao-cab"><h2>Horários de missa</h2>${seloConfirmacao(c, true)}</div>${missas.length ? `<table class="horarios"><tbody>${missas.map((l) => linhaHtml(l)).join('')}</tbody></table>` : '<p style="color:#5A6478">A paróquia ainda não informou os horários de missa.</p>'}</section>
${outros.length ? `<section class="secao"><h2>Confissões e atendimento</h2><table class="horarios"><tbody>${outros.join('')}</tbody></table></section>` : ''}
<section class="secao"><h2>Sobre a paróquia</h2>${sobre}${clero}${pastorais.length ? `<h3 class="sub-tit">Pastorais e grupos</h3><div class="chips-simples">${pastorais.map((p) => `<span class="chip">${esc(p)}</span>`).join('')}</div>` : ''}</section>
<section class="secao" id="mapa"><h2>Como chegar</h2><p>${esc(c.endereco || `${c.bairro}, ${c.cidade} - ${c.uf}`)}</p><div class="mapa-links"><a class="btn" href="${mapaUrl}" target="_blank" rel="noopener">Abrir no Google Maps</a><a class="btn sec" href="${wazeUrl}" target="_blank" rel="noopener">Rota no Waze</a></div></section>
<section class="nota"><div><strong>Algo desatualizado?</strong> Os horários podem mudar em feriados e datas especiais. Confirme com a paróquia e nos ajude a manter tudo correto.</div><a class="btn" href="${esc(wa(`Quero corrigir informações da ${c.nome} (${c.bairro}) no Vou pra Missa: ${urlAbs}`))}" target="_blank" rel="noopener">Informar correção</a></section>
</div>
<aside class="col-side" aria-label="Publicidade e outras igrejas">${banner('lateral1')}
${perto.length ? `<div class="perto"><h2>Outras igrejas perto</h2>${perto.map((p) => `<a href="${CTX.u(`igreja/${p.slug}/`)}"><b>${esc(p.nome)}</b><span>${esc(p.bairro)}${p.setor ? ` · Setor ${esc(p.setor)}` : ''}</span></a>`).join('')}</div>` : ''}
${banner('lateral2')}</aside></div>
${banner('rodape')}
</div>`;

  const jsonld = c.exemplo ? null : {
    '@context': 'https://schema.org', '@type': 'CatholicChurch', name: c.nome, url: urlAbs,
    address: { '@type': 'PostalAddress', streetAddress: c.endereco || undefined, addressLocality: c.cidade, addressRegion: c.uf, addressCountry: 'BR' },
    telephone: c.telefone || undefined
  };
  emitir(`igreja/${c.slug}/index.html`, layout({
    title: `${c.nome} — ${c.bairro}, ${c.cidade}: horários de missa`,
    desc: `Horários de missa, confissões e endereço da ${c.nome}, em ${c.bairro}, ${c.cidade}/${c.uf}.`,
    canonical: `/igreja/${c.slug}/`, body, uf: c.uf, jsonld, noindex: c.exemplo
  }), `/igreja/${c.slug}/`, !c.exemplo);
}

/* ---------- Páginas de texto ---------- */
function paginaTexto(rel, titulo, desc, conteudo, canonical) {
  CTX = mkctx(1);
  const body = `<div class="conteudo"><nav class="migalha" aria-label="Você está em">${migalhaBase()}<span>${esc(titulo)}</span></nav><article class="texto"><h1 class="titulo">${esc(titulo)}</h1>${conteudo()}</article>${banner('rodape')}</div>`;
  emitir(rel, layout({ title: titulo, desc, canonical, body }), canonical, true);
}

function paginasTexto() {
  paginaTexto('anuncie/index.html', 'Anuncie no Vou pra Missa', 'Espaços de publicidade para quem quer falar com quem procura missa e informações das paróquias.', () => `
<p>O Vou pra Missa reúne pessoas que procuram horários de missa e informações das paróquias da sua região. Anunciar aqui é falar com um público local, que está perto do seu negócio.</p>
<h2>Espaços disponíveis</h2>
<table><thead><tr><th>Espaço</th><th>Onde aparece</th><th>Tamanho</th></tr></thead><tbody>
<tr><td>Topo</td><td>Faixa larga no alto das páginas de região</td><td>${esc(banners.topo.tamanho)} px</td></tr>
<tr><td>Entre a lista</td><td>No meio da lista de igrejas</td><td>${esc(banners.lista.tamanho)} px</td></tr>
<tr><td>Lateral</td><td>Ao lado da lista e da página de cada igreja</td><td>${esc(banners.lateral1.tamanho)} e ${esc(banners.lateral2.tamanho)} px</td></tr>
<tr><td>Rodapé</td><td>Antes do rodapé, em todas as páginas</td><td>${esc(banners.rodape.tamanho)} px</td></tr>
<tr><td>Igreja em destaque</td><td>Carrossel e topo da lista da região</td><td>Para paróquias e comunidades</td></tr>
</tbody></table>
<h2>Como funciona</h2>
<ol><li>Você escolhe o espaço e a região (estado, zona ou diocese).</li><li>Envia a imagem e o link de destino.</li><li>Publicamos e você acompanha o período combinado.</li></ol>
<p>Estamos em fase de testes: os primeiros anunciantes têm condições especiais. Fale conosco para conhecer os valores.</p>
<p><a class="btn" style="display:inline-block" href="${esc(wa('Olá! Quero anunciar no Vou pra Missa.'))}" target="_blank" rel="noopener">Falar pelo WhatsApp</a></p>`, '/anuncie/');

  const destinoCadastro = cfg.formularioCadastro
    ? `<a class="btn" style="display:inline-block" href="${esc(cfg.formularioCadastro)}" target="_blank" rel="noopener">Preencher o formulário</a>`
    : `<a class="btn" style="display:inline-block" href="${esc(wa('Olá! Quero cadastrar a minha paróquia no Vou pra Missa.'))}" target="_blank" rel="noopener">Cadastrar pelo WhatsApp</a>`;
  paginaTexto('cadastre-sua-paroquia/index.html', 'Cadastre sua paróquia', 'Cadastro gratuito de paróquias, capelas e comunidades no Vou pra Missa.', () => `
<p>O cadastro é gratuito. Quanto mais completas as informações, mais fácil é para as pessoas encontrarem a sua comunidade.</p>
<h2>O que vamos pedir</h2>
<ul><li>Nome da paróquia, capela ou comunidade e a diocese</li><li>Endereço, telefone da secretaria e WhatsApp (se houver)</li><li>Horários de missa, confissões e atendimento da secretaria</li><li>Uma foto da igreja e um pequeno texto de apresentação (opcionais)</li></ul>
<h2>Como funciona</h2>
<ol><li>Você envia as informações.</li><li>Nossa equipe confere e publica a página da sua comunidade.</li><li>Para corrigir ou atualizar horários, basta nos avisar. Cada página mostra a data da última confirmação.</li></ol>
<p>${destinoCadastro}</p>`, '/cadastre-sua-paroquia/');

  paginaTexto('sobre/index.html', 'Sobre o projeto', 'Conheça o Vou pra Missa, um projeto independente para ajudar as pessoas a encontrarem missa perto de casa.', () => `
<p>O <strong>Vou pra Missa</strong> nasceu na Zona Leste de São Paulo com uma ideia simples: ajudar qualquer pessoa a encontrar uma missa perto de onde está, com horários e endereços confiáveis.</p>
<p>É um projeto <strong>independente</strong>. Não temos vínculo oficial com a Igreja Católica nem com qualquer diocese, e trabalhamos para que cada paróquia confirme e atualize as suas próprias informações.</p>
<h2>Como cuidamos das informações</h2>
<ul><li>Cada página mostra a data da última confirmação dos horários.</li><li>Os horários podem mudar em feriados e datas especiais: confirme sempre com a paróquia.</li><li>Se encontrar algo errado, use o botão "Informar correção" na página da igreja.</li></ul>`, '/sobre/');

  paginaTexto('privacidade/index.html', 'Privacidade', 'Como o Vou pra Missa trata os seus dados.', () => `
<p><em>Texto provisório, a ser revisado antes do lançamento oficial.</em></p>
<h2>O que coletamos</h2>
<p>Não pedimos cadastro nem login. A sua lista de igrejas favoritas fica salva apenas no seu aparelho (armazenamento local do navegador) e não é enviada para nós.</p>
<h2>Fontes e serviços externos</h2>
<p>As fontes de letra são carregadas dos servidores do Google. Ao abrir mapas ou rotas, você é levado ao Google Maps ou ao Waze, que têm suas próprias políticas de privacidade.</p>
<h2>Estatísticas de acesso</h2>
<p>Se passarmos a usar ferramentas de estatística ou publicidade com cookies, avisaremos aqui e pediremos o seu consentimento.</p>
<h2>Contato</h2>
<p>Dúvidas ou pedidos sobre dados: <a href="mailto:${esc(cfg.email)}">${esc(cfg.email)}</a>.</p>`, '/privacidade/');

  CTX = mkctx(1);
  emitir('minha-lista/index.html', layout({
    title: 'Minha lista', desc: 'As igrejas que você salvou neste aparelho.', noindex: true,
    body: `<div class="conteudo"><nav class="migalha" aria-label="Você está em">${migalhaBase()}<span>Minha lista</span></nav><h1 class="titulo">Minha lista</h1><p style="margin:0;color:#5A6478">As igrejas que você salvou ficam guardadas neste aparelho, sem precisar de login.</p><div id="minha-lista" aria-live="polite"></div></div>`
  }), '/minha-lista/', false);
}

function pagina404() {
  CTX = mkctx(0, (cfg.basePath || '') + '/');
  emitir('404.html', layout({
    title: 'Página não encontrada', noindex: true,
    body: `<div class="conteudo"><div class="vazio-msg"><h1 class="titulo">Página não encontrada</h1><p>O endereço que você abriu não existe ou foi movido.</p><a class="btn" href="${CTX.u('')}">Voltar ao início</a></div></div>`
  }), null, false);
}

/* =====================================================================
   4. Gerar tudo
   ===================================================================== */
paginaEntrada();
paginasListagem();
for (const c of igrejas) paginaIgreja(c);
paginasTexto();
pagina404();

fs.rmSync(OUT, { recursive: true, force: true });
const gravar = (rel, conteudo) => {
  const dest = path.join(OUT, rel);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, conteudo);
};
for (const p of paginas) gravar(p.rel, p.html);
fs.cpSync(path.join(ROOT, 'assets'), path.join(OUT, 'assets'), { recursive: true });

// Dados para busca e "Minha lista" (carregados só quando necessário)
const dadosJs = igrejas.map((c) => ({ id: c.id, slug: c.slug, nome: c.nome, bairro: c.bairro, cidade: c.cidade, uf: c.uf, diocese: c.diocese, setor: c.setor, missas: c.tokens }));
gravar('data/igrejas.js', `window.VPM_DATA=${JSON.stringify(dadosJs)};\n`);

// robots.txt e sitemap.xml
const indexaveis = paginas.filter((p) => p.indexar && p.url);
gravar('robots.txt', cfg.lancado
  ? `User-agent: *\nAllow: /\nSitemap: ${cfg.siteUrl}/sitemap.xml\n`
  : 'User-agent: *\nDisallow: /\n');
gravar('sitemap.xml', `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${
  (cfg.lancado ? indexaveis : []).map((p) => `  <url><loc>${esc(cfg.siteUrl + p.url)}</loc></url>`).join('\n')
}\n</urlset>\n`);
if (!PREVIEW && cfg.usarDominioProprio) gravar('CNAME', cfg.dominio + '\n');
gravar('.nojekyll', '');

/* Resumo */
console.log(`\nVou pra Missa — site gerado em ${path.relative(process.cwd(), OUT) || '.'}/`);
console.log(`  ${plural(igrejas.length, 'igreja', 'igrejas')} · ${paginas.length} páginas${PREVIEW ? ' · modo preview (abre direto no computador)' : ''}`);
if (!cfg.lancado) console.log('  Aviso: "lancado" está false em dados/config.json — o Google NÃO vai indexar o site (bom para testes).');
if (avisos.length) {
  console.log(`\n  ${plural(avisos.length, 'aviso', 'avisos')} nos dados:`);
  for (const a of avisos) console.log(`   - ${a}`);
} else console.log('  Nenhum aviso nos dados.');
console.log('');
