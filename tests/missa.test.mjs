import assert from 'node:assert/strict';
import { parseDias, labelDias, parseFaixa, fmtFaixa, parseCSV, slugify, parseLista, parseClero, fmtDataCurta, idadeDias } from '../build/lib.mjs';
await import('../assets/app.js');
const { proximaMissa, parseMissas, rotulo, agoraSP } = globalThis.VPM_LOGICA;

// --- dias ---
assert.deepEqual(parseDias('seg-sex'), ['seg','ter','qua','qui','sex']);
assert.deepEqual(parseDias('sáb'), ['sab']);
assert.deepEqual(parseDias('ter,qui'), ['ter','qui']);
assert.deepEqual(parseDias('qua e sex'), ['qua','sex']);
assert.deepEqual(parseDias('sex-seg'), ['seg','sex','sab','dom']);
assert.equal(parseDias('todos').length, 7);
assert.deepEqual(parseDias('xyz'), []);
assert.equal(labelDias(parseDias('seg-sex')), 'Segunda a sexta');
assert.equal(labelDias(parseDias('dom')), 'Domingo');
assert.equal(labelDias(parseDias('qua')), 'Quarta-feira');
assert.equal(labelDias(parseDias('ter-sex')), 'Terça a sexta');
assert.equal(labelDias(parseDias('sab-dom')), 'Sábado e domingo');
assert.equal(labelDias(parseDias('seg,qua,sex')), 'Segunda, quarta e sexta');
// --- horas ---
assert.equal(fmtFaixa(parseFaixa('19:30')), '19h30');
assert.equal(fmtFaixa(parseFaixa('8h')), '08h');
assert.equal(fmtFaixa(parseFaixa('16:00-18:00')), '16h às 18h');
assert.equal(parseFaixa('25:00'), null);
assert.equal(parseFaixa('abc'), null);
// --- csv ---
const csv = parseCSV('id;nome;obs\n1;"Igreja, Matriz";"disse ""oi"""\n2;Capela;\n');
assert.equal(csv[0].nome, 'Igreja, Matriz'); assert.equal(csv[0].obs, 'disse "oi"'); assert.equal(csv.length, 2);
assert.equal(slugify('Paróquia São José'), 'paroquia-sao-jose');

// --- próxima missa (0=dom ... 6=sab); missas de exemplo da paróquia 040 ---
const m = parseMissas('2@19:30 4@19:30 3@15:00 6@19:00 0@08:00 0@10:00 0@19:00');
const T = (h, mi = 0) => h * 60 + mi;
// terça 18:00 -> hoje 19h30
let p = proximaMissa(m, { dia: 2, min: T(18) }); assert.deepEqual([p.off, p.d, p.min], [0, 2, T(19, 30)]);
assert.equal(rotulo(p).txt, 'Missa hoje · 19h30'); assert.equal(rotulo(p).cls, 'badge-hoje');
// terça 20:00 -> já passou: próxima é quarta 15h (amanhã)
p = proximaMissa(m, { dia: 2, min: T(20) }); assert.deepEqual([p.off, p.d, p.min], [1, 3, T(15)]);
assert.equal(rotulo(p).txt, 'Amanhã · 15h');
// segunda (sem missa) -> próxima é terça (amanhã) 19h30
p = proximaMissa(m, { dia: 1, min: T(12) }); assert.deepEqual([p.off, p.d], [1, 2]);
// sexta (sem missa) -> próxima: sábado 19h (amanhã)
p = proximaMissa(m, { dia: 5, min: T(10) }); assert.deepEqual([p.off, p.d, p.min], [1, 6, T(19)]);
// quinta 22:00 -> sexta sem missa, sábado 19h => off 2 "Próxima: sáb · 19h"
p = proximaMissa(m, { dia: 4, min: T(22) }); assert.equal(rotulo(p).txt, 'Próxima: sáb · 19h');
// domingo 19:30 -> acabou o dia, próxima terça 19h30
p = proximaMissa(m, { dia: 0, min: T(19, 30) }); assert.equal(rotulo(p).txt, 'Próxima: ter · 19h30');
// só uma missa por semana, e ela já passou hoje -> semana que vem (off 7)
p = proximaMissa(parseMissas('3@19:00'), { dia: 3, min: T(20) }); assert.equal(p.off, 7);
// sem missas
assert.equal(rotulo(proximaMissa([], { dia: 1, min: 0 })).txt, 'Horários a confirmar');
// fuso: 2026-10-14 (quarta) 23:30 UTC-3 = 02:30 UTC do dia 15 -> ainda quarta em São Paulo
const a = agoraSP(new Date('2026-10-15T02:30:00Z')); assert.deepEqual([a.dia, a.min], [3, T(23, 30)]);
const b = agoraSP(new Date('2026-10-15T03:00:00Z')); assert.deepEqual([b.dia, b.min], [4, 0]); // meia-noite = quinta 00:00
// --- listas, clero, datas ---
assert.deepEqual(parseLista('a.jpg; b.jpg | c.jpg;'), ['a.jpg','b.jpg','c.jpg']);
assert.deepEqual(parseClero('Pároco: Pe. Fulano; Vigário paroquial: Pe. Ciclano'), [{cargo:'Pároco',nome:'Pe. Fulano'},{cargo:'Vigário paroquial',nome:'Pe. Ciclano'}]);
assert.deepEqual(parseClero('Pe. Sem Cargo'), [{cargo:'',nome:'Pe. Sem Cargo'}]);
assert.deepEqual(parseClero(''), []);
assert.equal(fmtDataCurta('2026-10-14'), '14/10'); assert.equal(fmtDataCurta('14/10/2026'), '');
assert.equal(idadeDias('2026-10-01', new Date(2026, 9, 15)), 14);
assert.equal(idadeDias('lixo'), null);
console.log('todos os testes passaram');
