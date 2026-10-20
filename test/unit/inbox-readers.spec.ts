import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { deflateRawSync } from 'node:zlib';
import { findDate, findTime, ruleBasedExtract, sanitize } from '../../src/modules/inbox/extraction';
import { readDocument, unzip } from '../../src/modules/inbox/readers';

const fx = (n: string) => readFileSync(join(__dirname, '../fixtures/inbox', n));
const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

describe('Smart inbox: reading documents', () => {
  it('reads Word text, keeping table rows on one line', () => {
    const r = readDocument(DOCX, fx('plan.docx'), null);
    expect(r).toEqual({ kind: 'text', text: 'Family plan\nPay electricity bill by 25 Oct & call plumber\nItem\tQty\nRice\t5 kg' });
  });

  it('reads every Excel sheet as a table', () => {
    const r = readDocument(XLSX, fx('budget.xlsx'), null);
    expect(r).toEqual({ kind: 'text', text: '# Sheet: Budget\nCategory\tPlanned\tSpent\nGroceries\t8000\t2500\nElectricity\t1500\n\n# Sheet: Notes\nHello <world>' });
  });

  it('passes PDFs and photos to the AI, refuses what it cannot read, never throws', () => {
    expect(readDocument('application/pdf', Buffer.from('%PDF-1.4'), null).kind).toBe('pdf');
    expect(readDocument('image/png', Buffer.alloc(10), null)).toMatchObject({ kind: 'image', mediaType: 'image/png' });
    expect(readDocument('image/png', Buffer.alloc(6 * 1024 * 1024), null).kind).toBe('unsupported');
    expect(readDocument(DOCX, Buffer.from('not a zip'), null).kind).toBe('unsupported');
    expect(readDocument('text/plain', Buffer.from('ignored'), 'stored text')).toEqual({ kind: 'text', text: 'stored text' });
  });

  it('refuses zip files that expand to something huge', () => {
    // A single 30 MB entry of zeros compresses to a few KB.
    const big = Buffer.alloc(30 * 1024 * 1024);
    const data = deflateRawSync(big);
    const name = Buffer.from('word/document.xml');
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(big.length, 22);
    local.writeUInt16LE(name.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(big.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(0, 42);
    const cdStart = local.length + name.length + data.length;
    const eocd = Buffer.alloc(22);
    eocd.writeUInt32LE(0x06054b50, 0);
    eocd.writeUInt16LE(1, 10);
    eocd.writeUInt32LE(central.length + name.length, 12);
    eocd.writeUInt32LE(cdStart, 16);
    const zip = Buffer.concat([local, name, data, central, name, eocd]);
    expect(() => unzip(zip, () => true)).toThrow(/too large/);
    expect(readDocument(DOCX, zip, null).kind).toBe('unsupported');
  });
});

describe('Smart inbox: reading without AI', () => {
  const today = '2026-10-20'; // a Tuesday

  it('understands common date and time formats', () => {
    expect(findDate('on 2026-11-02', today)?.date).toBe('2026-11-02');
    expect(findDate('by 25/10/2026', today)?.date).toBe('2026-10-25');
    expect(findDate('25 Oct', today)?.date).toBe('2026-10-25');
    expect(findDate('Jan 3', today)?.date).toBe('2027-01-03');
    expect(findDate('tomorrow', today)?.date).toBe('2026-10-21');
    expect(findDate('next Tuesday', today)?.date).toBe('2026-10-27');
    expect(findDate('on Friday', today)?.date).toBe('2026-10-23');
    expect(findTime('at 6.30 pm')?.time).toBe('18:30');
    expect(findTime('9am')?.time).toBe('09:00');
    expect(findTime('14:05')?.time).toBe('14:05');
  });

  it('uses the folder to decide what each line is, and prefixes to override it', () => {
    const r = ruleBasedExtract('- Pay bill by 25 Oct\n[ ] Call plumber tomorrow 10am\nBuy: milk 2 L', 'tasks', today);
    expect(r.items).toEqual([
      { type: 'task', title: 'Pay bill', date: '2026-10-25' },
      { type: 'task', title: 'Call plumber', date: '2026-10-21', time: '10:00' },
      { type: 'shopping_item', name: 'milk', quantity: 2, unit: 'l' },
    ]);
    expect(ruleBasedExtract('Rice 5 kg\n2 x Milk\nEggs - 12', 'shopping', today).items).toEqual([
      { type: 'shopping_item', name: 'Rice', quantity: 5, unit: 'kg' },
      { type: 'shopping_item', name: 'Milk', quantity: 2 },
      { type: 'shopping_item', name: 'Eggs', quantity: 12 },
    ]);
    expect(ruleBasedExtract('Groceries: 8000\nRent - ₹15,000 / 15,000', 'budget', today).items).toEqual([
      { type: 'budget_line', name: 'Groceries', planned: 8000 },
      { type: 'budget_line', name: 'Rent', planned: 15000, spent: 15000 },
    ]);
    expect(ruleBasedExtract('BP tablet 8am', 'family_care', today).items).toEqual([{ type: 'medicine', name: 'BP tablet', times: ['08:00'] }]);
    // Not sure what it is, and no prefixes: nothing is guessed.
    expect(ruleBasedExtract('some words', 'mixed', today).items).toEqual([]);
  });

  it('reads tables by their column names', () => {
    const r = ruleBasedExtract('Item,Qty,Unit\n"Basmati rice, aged",5,kg\nMilk,2,L', null, today);
    expect(r.category).toBe('shopping');
    expect(r.items[0]).toEqual({ type: 'shopping_item', name: 'Basmati rice, aged', quantity: 5, unit: 'kg' });
    const inv = ruleBasedExtract('Name\tBrand\tWarranty\nAC\tVoltas\t2027-04-01', null, today);
    expect(inv.items).toEqual([{ type: 'inventory_item', name: 'AC', brand: 'Voltas', warranty_until: '2027-04-01' }]);
  });
});

describe('Smart inbox: AI answers are cleaned before use', () => {
  it('keeps only known item types and sane values', () => {
    const r = sanitize({
      category: 'hacking',
      summary: 'x'.repeat(1000),
      items: [{ type: 'task', title: 'ok', evil: { nested: true }, n: Infinity }, { type: 'send_money', to: 'x' }, null, 'string'],
    });
    expect(r.category).toBe('other');
    expect(r.summary).toHaveLength(300);
    expect(r.items).toEqual([{ type: 'task', title: 'ok' }]);
    expect(sanitize({ items: Array.from({ length: 300 }, () => ({ type: 'task', title: 't' })) }).items).toHaveLength(100);
  });
});
