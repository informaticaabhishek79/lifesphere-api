import { inflateRawSync } from 'node:zlib';

/** What the inbox can hand to the reader: plain text, or a PDF/image the AI reads itself. */
export type DocContent =
  | { kind: 'text'; text: string }
  | { kind: 'pdf'; base64: string }
  | { kind: 'image'; mediaType: 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp'; base64: string }
  | { kind: 'unsupported'; reason: string };

const MAX_TEXT = 60_000;
/** Office files are zip archives; refuse ones that expand to more than this (zip bombs). */
const MAX_UNZIPPED = 25 * 1024 * 1024;
const PDF_MAX = 20 * 1024 * 1024;
const IMAGE_MAX = 5 * 1024 * 1024;

const OFFICE = {
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
};
const TEXT = new Set(['text/plain', 'text/markdown', 'text/csv', 'application/json']);
const IMAGES = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp']);

/** Minimal reader for the zip files Office documents are; only stored and deflated entries. */
export function unzip(buf: Buffer, wanted: (name: string) => boolean): Map<string, Buffer> {
  const out = new Map<string, Buffer>();
  // End of central directory: last 22 bytes plus an optional comment of up to 64 KiB.
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 65_535); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('not a zip file');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  let total = 0;
  for (let n = 0; n < count && p + 46 <= buf.length; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) break;
    const method = buf.readUInt16LE(p + 10);
    const compSize = buf.readUInt32LE(p + 20);
    const size = buf.readUInt32LE(p + 24);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.subarray(p + 46, p + 46 + nameLen).toString('utf8');
    p += 46 + nameLen + extraLen + commentLen;
    if (!wanted(name)) continue;
    total += size;
    if (total > MAX_UNZIPPED) throw new Error('document is too large to read');
    if (local + 30 > buf.length || buf.readUInt32LE(local) !== 0x04034b50) continue;
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const data = buf.subarray(start, start + compSize);
    if (method === 0) out.set(name, Buffer.from(data));
    else if (method === 8) out.set(name, inflateRawSync(data, { maxOutputLength: Math.max(size, 1) + 1024 }));
  }
  return out;
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
export function decodeXml(s: string) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === '#') {
      const code = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : '';
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

const stripTags = (xml: string) => decodeXml(xml.replace(/<[^>]+>/g, ''));
const numeric = (a: string, b: string) => Number(a.match(/(\d+)\.xml$/)?.[1] ?? 0) - Number(b.match(/(\d+)\.xml$/)?.[1] ?? 0);

export function docxText(buf: Buffer): string {
  const files = unzip(buf, (n) => n === 'word/document.xml');
  const xml = files.get('word/document.xml')?.toString('utf8') ?? '';
  return stripTags(
    xml
      .replace(/<w:tab\/>/g, '\t')
      .replace(/<w:br\/>/g, '\n')
      // Table cells: keep a row on one line, cells separated by tabs.
      .replace(/<w:tc[ >][\s\S]*?<\/w:tc>/g, (cell) => `${cell.replace(/<\/w:p>/g, ' ')}\t`)
      .replace(/<\/w:tr>/g, '\n')
      .replace(/<\/w:p>/g, '\n'),
  )
    .replace(/ +\t/g, '\t')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Column letters of a cell reference ("C12" → 2). */
function colIndex(ref: string) {
  const letters = ref.match(/^[A-Z]+/)?.[0] ?? 'A';
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

export function xlsxText(buf: Buffer): string {
  const files = unzip(buf, (n) => n === 'xl/sharedStrings.xml' || n === 'xl/workbook.xml' || /^xl\/worksheets\/sheet\d+\.xml$/.test(n));
  const shared = [...(files.get('xl/sharedStrings.xml')?.toString('utf8') ?? '').matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) =>
    [...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((t) => decodeXml(t[1])).join(''),
  );
  const names = [...(files.get('xl/workbook.xml')?.toString('utf8') ?? '').matchAll(/<sheet [^>]*name="([^"]*)"/g)].map((m) => decodeXml(m[1]));
  const sheets = [...files.keys()].filter((k) => k.startsWith('xl/worksheets/')).sort(numeric);
  const parts: string[] = [];
  sheets.forEach((key, i) => {
    const xml = files.get(key)!.toString('utf8');
    const rows: string[] = [];
    for (const row of xml.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)) {
      const cells: string[] = [];
      for (const c of row[1].matchAll(/<c ([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const attrs = c[1];
        const body = c[2] ?? '';
        const ref = attrs.match(/r="([A-Z]+\d+)"/)?.[1];
        const type = attrs.match(/t="([a-zA-Z]+)"/)?.[1];
        let v = '';
        if (type === 's') v = shared[Number(body.match(/<v>(\d+)<\/v>/)?.[1] ?? -1)] ?? '';
        else if (type === 'inlineStr') v = stripTags(body);
        else v = decodeXml(body.match(/<v>([\s\S]*?)<\/v>/)?.[1] ?? '');
        const idx = ref ? colIndex(ref) : cells.length;
        while (cells.length < idx) cells.push('');
        cells[idx] = v.replace(/[\t\n]+/g, ' ').trim();
      }
      if (cells.some((c) => c)) rows.push(cells.join('\t'));
    }
    if (rows.length) parts.push(`# Sheet: ${names[i] ?? `Sheet ${i + 1}`}\n${rows.join('\n')}`);
  });
  return parts.join('\n\n');
}

export function pptxText(buf: Buffer): string {
  const files = unzip(buf, (n) => /^ppt\/slides\/slide\d+\.xml$/.test(n));
  return [...files.keys()]
    .sort(numeric)
    .map((k, i) => `# Slide ${i + 1}\n${[...files.get(k)!.toString('utf8').matchAll(/<a:t>([\s\S]*?)<\/a:t>/g)].map((m) => decodeXml(m[1])).join('\n')}`)
    .join('\n\n');
}

/** Turn a stored document into something the reader can use. Never throws. */
export function readDocument(mime: string, buf: Buffer, storedText: string | null): DocContent {
  try {
    if (TEXT.has(mime)) return { kind: 'text', text: (storedText ?? buf.toString('utf8')).slice(0, MAX_TEXT) };
    if (mime === OFFICE.docx) return { kind: 'text', text: docxText(buf).slice(0, MAX_TEXT) };
    if (mime === OFFICE.xlsx) return { kind: 'text', text: xlsxText(buf).slice(0, MAX_TEXT) };
    if (mime === OFFICE.pptx) return { kind: 'text', text: pptxText(buf).slice(0, MAX_TEXT) };
    if (mime === 'application/pdf') {
      if (buf.length > PDF_MAX) return { kind: 'unsupported', reason: 'This PDF is larger than 20 MB. Split it into smaller files.' };
      return { kind: 'pdf', base64: buf.toString('base64') };
    }
    if (IMAGES.has(mime)) {
      if (buf.length > IMAGE_MAX) return { kind: 'unsupported', reason: 'This photo is larger than 5 MB. Take a smaller photo or save it as a PDF.' };
      return { kind: 'image', mediaType: mime as 'image/png', base64: buf.toString('base64') };
    }
    return { kind: 'unsupported', reason: 'This type of file cannot be read yet. Use PDF, a photo, Word, Excel, CSV or a text file.' };
  } catch {
    return { kind: 'unsupported', reason: 'This file could not be opened. It may be damaged or password-protected.' };
  }
}
