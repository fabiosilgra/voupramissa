// Funções de apoio do gerador do site Vou pra Missa.
// Normalmente você NÃO precisa mexer aqui.

export const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export const slugify = (s) =>
  String(s || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

export const sim = (v) => /^(s|sim|1|true|x)$/i.test(String(v || '').trim());

/* ---------- CSV (aceita vírgula ou ponto e vírgula, aspas, Excel/Google Sheets) ---------- */
export function parseCSV(text) {
  text = String(text).replace(/^﻿/, '');
  const first = text.split(/\r?\n/, 1)[0] || '';
  const delim = first.split(';').length > first.split(',').length ? ';' : ',';
  const rows = [];
  let row = [];
  let field = '';
  let inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else inQ = false;
      } else field += c;
    } else if (c === '"') inQ = true;
    else if (c === delim) { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = ''; rows.push(row); row = [];
    } else field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  if (!rows.length) return [];
  const head = rows.shift().map((h) => slugify(h).replace(/-/g, '_'));
  return rows
    .filter((r) => r.some((v) => v.trim() !== ''))
    .map((r) => Object.fromEntries(head.map((h, i) => [h, (r[i] ?? '').trim()])));
}

/* ---------- Dias da semana ---------- */
// Ordem usada nos intervalos: segunda ... domingo
export const DIAS = ['seg', 'ter', 'qua', 'qui', 'sex', 'sab', 'dom'];
const NOME_CURTO = { seg: 'Segunda', ter: 'Terça', qua: 'Quarta', qui: 'Quinta', sex: 'Sexta', sab: 'Sábado', dom: 'Domingo' };
const NOME_LONGO = { seg: 'Segunda-feira', ter: 'Terça-feira', qua: 'Quarta-feira', qui: 'Quinta-feira', sex: 'Sexta-feira', sab: 'Sábado', dom: 'Domingo' };

const tokDia = (t) =>
  t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z]/g, '').slice(0, 3);

// "seg-sex", "dom", "ter,qui", "qua e sex", "todos"  ->  ['seg','ter',...]
export function parseDias(spec) {
  const raw = String(spec || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
  if (!raw) return [];
  if (/^(todos|todo dia|diario|todos os dias)$/.test(raw)) return [...DIAS];
  const out = new Set();
  for (const parte of raw.split(/\s*(?:,|;|\be\b)\s*/)) {
    const p = parte.trim();
    if (!p) continue;
    const range = p.split(/\s*(?:-|\ba\b|\bate\b)\s*/);
    if (range.length === 2) {
      const a = DIAS.indexOf(tokDia(range[0]));
      const b = DIAS.indexOf(tokDia(range[1]));
      if (a < 0 || b < 0) return [];
      let i = a;
      for (let n = 0; n < 7; n++) {
        out.add(DIAS[i]);
        if (i === b) break;
        i = (i + 1) % 7;
      }
    } else {
      const d = tokDia(p);
      if (!DIAS.includes(d)) return [];
      out.add(d);
    }
  }
  return DIAS.filter((d) => out.has(d));
}

export function labelDias(dias) {
  const idx = dias.map((d) => DIAS.indexOf(d)).sort((a, b) => a - b);
  if (idx.length === 7) return 'Todos os dias';
  if (idx.length === 1) return NOME_LONGO[DIAS[idx[0]]];
  const contiguo = idx.every((v, i) => i === 0 || v === idx[i - 1] + 1);
  const nome = (i) => NOME_CURTO[DIAS[i]];
  if (contiguo && idx.length === 2) return `${nome(idx[0])} e ${nome(idx[1]).toLowerCase()}`;
  if (contiguo) return `${nome(idx[0])} a ${nome(idx[idx.length - 1]).toLowerCase()}`;
  const nomes = idx.map((i, n) => (n === 0 ? nome(i) : nome(i).toLowerCase()));
  return nomes.slice(0, -1).join(', ') + ' e ' + nomes[nomes.length - 1];
}

// índice JS (0 = domingo ... 6 = sábado)
export const jsDia = (d) => (DIAS.indexOf(d) + 1) % 7;

/* ---------- Horas ---------- */
export function horaMin(s) {
  const m = /^(\d{1,2})(?:[:h](\d{2})?)?$/.exec(String(s).trim());
  if (!m) return NaN;
  const h = +m[1];
  const mi = +(m[2] || 0);
  if (h > 23 || mi > 59) return NaN;
  return h * 60 + mi;
}
export function fmtMin(min) {
  const h = String(Math.floor(min / 60)).padStart(2, '0');
  const m = min % 60;
  return m ? `${h}h${String(m).padStart(2, '0')}` : `${h}h`;
}
export const hhmm = (min) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;

// "19:30" -> {a:1170,b:null}; "16:00-18:00" -> {a:960,b:1080}; inválida -> null
export function parseFaixa(s) {
  const partes = String(s).split('-').map((x) => x.trim());
  if (partes.length > 2 || !partes[0]) return null;
  const a = horaMin(partes[0]);
  if (Number.isNaN(a)) return null;
  if (partes.length === 1) return { a, b: null };
  const b = horaMin(partes[1]);
  if (Number.isNaN(b)) return null;
  return { a, b };
}
export const fmtFaixa = (f) => (f.b == null ? fmtMin(f.a) : `${fmtMin(f.a)} às ${fmtMin(f.b)}`);

export function fmtData(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || '').trim());
  return m ? `${m[3]}/${m[2]}/${m[1]}` : '';
}

/* ---------- Listas dentro de uma célula ("a; b; c") ---------- */
export const parseLista = (s) =>
  String(s || '').split(/[;|]/).map((x) => x.trim()).filter(Boolean);

// "Pároco: Pe. Fulano; Vigário paroquial: Pe. Ciclano" -> [{cargo, nome}]
export function parseClero(s) {
  return parseLista(s).map((item) => {
    const i = item.indexOf(':');
    return i < 0 ? { cargo: '', nome: item } : { cargo: item.slice(0, i).trim(), nome: item.slice(i + 1).trim() };
  }).filter((x) => x.nome);
}

export const ehUrl = (s) => /^https?:\/\//i.test(String(s || ''));

// "2026-10-14" -> "14/10"
export function fmtDataCurta(iso) {
  const m = /^\d{4}-(\d{2})-(\d{2})$/.exec(String(iso || '').trim());
  return m ? `${m[2]}/${m[1]}` : '';
}

// dias entre a data (AAAA-MM-DD) e hoje; null se inválida
export function idadeDias(iso, hoje = new Date()) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || '').trim());
  if (!m) return null;
  const d = Date.UTC(+m[1], +m[2] - 1, +m[3]);
  const h = Date.UTC(hoje.getFullYear(), hoje.getMonth(), hoje.getDate());
  return Math.round((h - d) / 86400000);
}
