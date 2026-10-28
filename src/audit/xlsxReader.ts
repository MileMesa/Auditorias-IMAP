import type { AuditModel, AuditRecord, Criterion, Mark, Program } from './types';

type CellValue = string | number | null;
type SheetGrid = Map<number, Map<number, CellValue>>;

const textDecoder = new TextDecoder('utf-8');

async function readZip(buffer: ArrayBuffer): Promise<Map<string, Uint8Array>> {
  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);
  let endOffset = -1;
  const lowerBound = Math.max(0, bytes.length - 22 - 65_535);
  for (let offset = bytes.length - 22; offset >= lowerBound; offset -= 1) {
    if (view.getUint32(offset, true) === 0x06054b50) {
      endOffset = offset;
      break;
    }
  }
  if (endOffset < 0) throw new Error('El archivo no parece ser un Excel .xlsx válido.');

  const count = view.getUint16(endOffset + 10, true);
  let cursor = view.getUint32(endOffset + 16, true);
  const files = new Map<string, Uint8Array>();
  for (let index = 0; index < count; index += 1) {
    if (view.getUint32(cursor, true) !== 0x02014b50) throw new Error('No se pudo leer la estructura del Excel.');
    const method = view.getUint16(cursor + 10, true);
    const compressedSize = view.getUint32(cursor + 20, true);
    const nameLength = view.getUint16(cursor + 28, true);
    const extraLength = view.getUint16(cursor + 30, true);
    const commentLength = view.getUint16(cursor + 32, true);
    const localOffset = view.getUint32(cursor + 42, true);
    const name = textDecoder.decode(bytes.subarray(cursor + 46, cursor + 46 + nameLength));
    const localNameLength = view.getUint16(localOffset + 26, true);
    const localExtraLength = view.getUint16(localOffset + 28, true);
    const contentOffset = localOffset + 30 + localNameLength + localExtraLength;
    const compressed = bytes.slice(contentOffset, contentOffset + compressedSize);

    if (method === 0) files.set(name, compressed);
    else if (method === 8) {
      if (typeof DecompressionStream === 'undefined') {
        throw new Error('Este navegador no puede descomprimir Excel. Prueba con Edge o Chrome actualizado.');
      }
      const stream = new Blob([compressed]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
      files.set(name, new Uint8Array(await new Response(stream).arrayBuffer()));
    } else throw new Error('El Excel usa un método de compresión que no es compatible.');
    cursor += 46 + nameLength + extraLength + commentLength;
  }
  return files;
}

function xmlFile(files: Map<string, Uint8Array>, path: string): Document {
  const data = files.get(path);
  if (!data) throw new Error(`Falta una parte necesaria del Excel (${path}).`);
  const document = new DOMParser().parseFromString(textDecoder.decode(data), 'application/xml');
  if (document.querySelector('parsererror')) throw new Error('El Excel contiene una hoja que no se pudo leer.');
  return document;
}

function columnIndex(cellRef: string): number {
  const letters = cellRef.match(/^[A-Z]+/i)?.[0]?.toUpperCase() ?? '';
  return [...letters].reduce((value, letter) => value * 26 + letter.charCodeAt(0) - 64, 0);
}

function parseSharedStrings(files: Map<string, Uint8Array>): string[] {
  const data = files.get('xl/sharedStrings.xml');
  if (!data) return [];
  const document = new DOMParser().parseFromString(textDecoder.decode(data), 'application/xml');
  return Array.from(document.getElementsByTagName('si')).map((item) =>
    Array.from(item.getElementsByTagName('t')).map((part) => part.textContent ?? '').join(''),
  );
}

function sheetGrid(document: Document, sharedStrings: string[]): SheetGrid {
  const grid: SheetGrid = new Map();
  Array.from(document.getElementsByTagName('c')).forEach((cell) => {
    const reference = cell.getAttribute('r') ?? '';
    const row = Number(reference.match(/\d+/)?.[0] ?? 0);
    const col = columnIndex(reference);
    if (!row || !col) return;
    const type = cell.getAttribute('t');
    const valueNode = cell.getElementsByTagName('v')[0];
    const inlineNode = cell.getElementsByTagName('is')[0];
    let value: CellValue = valueNode?.textContent ?? null;
    if (type === 's' && value !== null) value = sharedStrings[Number(value)] ?? '';
    else if (type === 'inlineStr' && inlineNode) {
      value = Array.from(inlineNode.getElementsByTagName('t')).map((part) => part.textContent ?? '').join('');
    } else if (type !== 'str' && type !== 'e' && value !== null && String(value).trim() !== '' && Number.isFinite(Number(value))) {
      value = Number(value);
    }
    if (!grid.has(row)) grid.set(row, new Map());
    grid.get(row)!.set(col, value);
  });
  return grid;
}

function valueAt(grid: SheetGrid, row: number, col: number): CellValue {
  return grid.get(row)?.get(col) ?? null;
}

function resolveSheets(files: Map<string, Uint8Array>, sharedStrings: string[]): Record<Program, SheetGrid> {
  const workbook = xmlFile(files, 'xl/workbook.xml');
  const relationships = xmlFile(files, 'xl/_rels/workbook.xml.rels');
  const targets = new Map<string, string>();
  Array.from(relationships.getElementsByTagName('Relationship')).forEach((relation) => {
    const id = relation.getAttribute('Id');
    const target = relation.getAttribute('Target');
    if (id && target) targets.set(id, target);
  });
  const resolved: Partial<Record<Program, SheetGrid>> = {};
  Array.from(workbook.getElementsByTagName('sheet')).forEach((sheet) => {
    const name = sheet.getAttribute('name')?.trim().toUpperCase();
    if (name !== 'DM' && name !== 'HTA') return;
    const relationId = sheet.getAttribute('r:id') ?? sheet.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id');
    const target = relationId ? targets.get(relationId) : undefined;
    if (!target) return;
    const path = target.startsWith('/') ? target.slice(1) : target.startsWith('xl/') ? target : `xl/${target.replace(/^\.\//, '')}`;
    resolved[name as Program] = sheetGrid(xmlFile(files, path), sharedStrings);
  });
  if (!resolved.DM || !resolved.HTA) throw new Error('No encontré las hojas DM y HTA en el Excel. Carga la plantilla R-GCAL101-76.');
  return resolved as Record<Program, SheetGrid>;
}

function marker(value: CellValue): boolean | null {
  if (value === null || value === '') return false;
  if (typeof value === 'number') return value > 0;
  const normalized = String(value).trim().toLowerCase();
  if (!normalized || normalized === '0' || normalized === 'false') return false;
  if (['1', 'x', '✓', '✔', 'si', 'sí', 'true', 'c', 'nc', 'na', 'n/a', 'cumple', 'no cumple', 'no aplica'].includes(normalized)) return true;
  return null;
}

function extractProgram(grid: SheetGrid, program: Program): { criteria: Criterion[]; records: AuditRecord[] } {
  const lastCriterionRow = program === 'DM' ? 39 : 43;
  const criteria: Criterion[] = [];
  for (let row = 12; row <= lastCriterionRow; row += 1) {
    const rawText = valueAt(grid, row, 2);
    if (typeof rawText !== 'string' || !rawText.trim()) continue;
    const rawNumber = valueAt(grid, row, 1);
    criteria.push({
      id: `${program}-${row}`,
      number: rawNumber === null || rawNumber === '' ? '—' : String(rawNumber),
      text: rawText.trim(),
      sheetRow: row,
    });
  }
  if (!criteria.length) throw new Error(`La hoja ${program} no tiene criterios de auditoría.`);

  const records = Array.from({ length: 25 }, (_, index): AuditRecord => {
    const slot = index + 1;
    const startColumn = 3 + index * 3;
    const marks: Record<string, Mark | null> = {};
    const errors: string[] = [];
    criteria.forEach((criterion) => {
      const values = [0, 1, 2].map((offset) => valueAt(grid, criterion.sheetRow, startColumn + offset));
      const flagged = values.map(marker);
      if (flagged.some((flag) => flag === null)) errors.push(`Fila ${criterion.sheetRow}: marca no reconocida.`);
      const selected = flagged.flatMap((flag, offset) => flag === true ? [offset] : []);
      if (selected.length > 1) errors.push(`Fila ${criterion.sheetRow}: hay más de una marca.`);
      marks[criterion.id] = selected.length === 1 && !flagged.includes(null)
        ? (['C', 'NC', 'NA'][selected[0]] as Mark)
        : null;
    });
    return { slot, marks, errors };
  });
  return { criteria, records };
}

export async function readAuditWorkbook(file: File): Promise<AuditModel> {
  if (!file.name.toLowerCase().endsWith('.xlsx')) throw new Error('Selecciona un archivo .xlsx.');
  const files = await readZip(await file.arrayBuffer());
  const sharedStrings = parseSharedStrings(files);
  const sheets = resolveSheets(files, sharedStrings);
  const dm = extractProgram(sheets.DM, 'DM');
  const hta = extractProgram(sheets.HTA, 'HTA');
  return {
    title: 'Auditoría de historias clínicas RCV',
    periodStart: '',
    periodEnd: '',
    samplingMethod: 'Muestra seleccionada por el auditor según protocolo institucional.',
    sourceVersion: 'R-GCAL101-76',
    criteria: { DM: dm.criteria, HTA: hta.criteria },
    records: { DM: dm.records, HTA: hta.records },
    updatedAt: new Date().toISOString(),
  };
}

