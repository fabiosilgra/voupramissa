// Leitor simples de arquivos .xlsx (Excel / LibreOffice / Google Planilhas), sem dependências.
// Devolve { "Nome da aba": [ {coluna: valor, ...}, ... ] } usando a 1ª linha de cada aba como cabeçalho.
import zlib from 'node:zlib';

function lerZip(buf) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 70000); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('Este arquivo não parece ser um .xlsx válido.');
  const total = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const arquivos = {};
  for (let n = 0; n < total; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) break;
    const metodo = buf.readUInt16LE(p + 10);
    const csize = buf.readUInt32LE(p + 20);
    const nlen = buf.readUInt16LE(p + 28);
    const elen = buf.readUInt16LE(p + 30);
    const clen = buf.readUInt16LE(p + 32);
    const off = buf.readUInt32LE(p + 42);
    const nome = buf.toString('utf8', p + 46, p + 46 + nlen);
    const lnlen = buf.readUInt16LE(off + 26);
    const lelen = buf.readUInt16LE(off + 28);
    const ini = off + 30 + lnlen + lelen;
    const dados = buf.subarray(ini, ini + csize);
    arquivos[nome] = () => (metodo === 0 ? dados : zlib.inflateRawSync(dados)).toString('utf8');
    p += 46 + nlen + elen + clen;
  }
  return arquivos;
}

const dec = (s) => s
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
  .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d))
  .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
  .replace(/&amp;/g, '&');

const textoDe = (xml) => {
  let t = '';
  for (const m of xml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)) t += m[1];
  return dec(t);
};

const colNum = (ref) => {
  let n = 0;
  for (const ch of ref.replace(/[0-9]/g, '')) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
};

export function lerXlsx(buf) {
  const z = lerZip(buf);
  const get = (n) => (z[n] ? z[n]() : null);
  const wb = get('xl/workbook.xml');
  if (!wb) throw new Error('Arquivo .xlsx sem workbook.xml.');
  const rels = get('xl/_rels/workbook.xml.rels') || '';
  const alvo = {};
  for (const m of rels.matchAll(/<Relationship\b([^>]*)>/g)) {
    const id = /Id="([^"]*)"/.exec(m[1]), t = /Target="([^"]*)"/.exec(m[1]);
    if (id && t) alvo[id[1]] = t[1].replace(/^\//, '').replace(/^(?!xl\/)/, 'xl/');
  }
  const compart = [];
  const ss = get('xl/sharedStrings.xml');
  if (ss) for (const m of ss.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)) compart.push(textoDe(m[1]));

  const abas = {};
  for (const m of wb.matchAll(/<sheet\b([^>]*)>/g)) {
    const nome = /name="([^"]*)"/.exec(m[1]);
    const rid = /r:id="([^"]*)"/.exec(m[1]);
    if (!nome || !rid || !alvo[rid[1]]) continue;
    const xml = get(alvo[rid[1]]);
    if (!xml) continue;
    const linhas = [];
    for (const rm of xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
      const linha = [];
      for (const cm of rm[1].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const attrs = cm[1], corpo = cm[2] || '';
        const ref = /r="([A-Z]+)\d+"/.exec(attrs);
        if (!ref) continue;
        const tipo = (/\bt="([^"]*)"/.exec(attrs) || [])[1];
        const v = /<v>([\s\S]*?)<\/v>/.exec(corpo);
        let val = '';
        if (tipo === 'inlineStr') val = textoDe(corpo);
        else if (tipo === 's') val = v ? compart[+v[1]] ?? '' : '';
        else if (tipo === 'str' || tipo === 'e') val = v ? dec(v[1]) : '';
        else if (tipo === 'b') val = v && v[1] === '1' ? 'sim' : 'não';
        else if (v) val = Number(v[1]); // número (inclui datas e horas do Excel)
        linha[colNum(ref[1])] = val;
      }
      linhas.push(linha);
    }
    // cabeçalho: primeira linha que tenha "id" ou "id_igreja" (permite linhas de instrução acima)
    let h = linhas.findIndex((l) => l.some((c) => /^(id|id_igreja)$/i.test(String(c ?? '').trim())));
    if (h < 0) h = 0;
    const cab = (linhas[h] || []).map((c) => String(c ?? '').trim().toLowerCase());
    const objs = [];
    for (let i = h + 1; i < linhas.length; i++) {
      const l = linhas[i];
      if (!l || l.every((c) => c === '' || c == null)) continue;
      const o = {};
      cab.forEach((k, j) => { if (k) o[k] = l[j] == null ? '' : l[j]; });
      objs.push(o);
    }
    abas[nome[1] && dec(nome[1])] = objs;
  }
  return abas;
}

/* Conversões de valores "do Excel" para o formato que o site entende */
const pad = (n) => String(n).padStart(2, '0');
export function horaExcel(v) {
  if (typeof v !== 'number') {
    // aceita "19h30", "19h", "19:30:00" e faixas "16h-18h"
    return String(v ?? '').trim()
      .replace(/(\d{1,2})\s*h\s*(\d{2})?/gi, (_, h, m) => `${h}:${m || '00'}`)
      .replace(/(\d{1,2}:\d{2}):\d{2}/g, '$1');
  }
  const min = Math.round((v % 1) * 1440);
  return `${pad(Math.floor(min / 60) % 24)}:${pad(min % 60)}`;
}
export function dataExcel(v) {
  if (typeof v !== 'number') {
    const t = String(v ?? '').trim();
    const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(t); // 12/10/2026
    return m ? `${m[3]}-${pad(+m[2])}-${pad(+m[1])}` : t;
  }
  const d = new Date(Math.round((v - 25569) * 86400000));
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}
