import type { AuditModel, AuditRecord, AuditSection, Criterion, Mark } from './types';

type CellValue = string | number | null;
type SheetGrid = Map<number, Map<number, CellValue>>;
type CellFilter = (row: number, column: number) => boolean;

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

function parseSharedStrings(files: Map<string, Uint8Array>): Element[] {
  const data = files.get('xl/sharedStrings.xml');
  if (!data) return [];
  const document = new DOMParser().parseFromString(textDecoder.decode(data), 'application/xml');
  return Array.from(document.getElementsByTagName('si'));
}

function sharedStringAt(strings: Element[], index: number): string {
  const item = strings[index];
  return item ? Array.from(item.getElementsByTagName('t')).map((part) => part.textContent ?? '').join('') : '';
}

function sheetGrid(document: Document, sharedStrings: Element[], includeCell: CellFilter): SheetGrid {
  const grid: SheetGrid = new Map();
  Array.from(document.getElementsByTagName('c')).forEach((cell) => {
    const reference = cell.getAttribute('r') ?? '';
    const row = Number(reference.match(/\d+/)?.[0] ?? 0);
    const col = columnIndex(reference);
    if (!row || !col || !includeCell(row, col)) return;
    const type = cell.getAttribute('t');
    const valueNode = cell.getElementsByTagName('v')[0];
    const inlineNode = cell.getElementsByTagName('is')[0];
    let value: CellValue = valueNode?.textContent ?? null;
    if (type === 's' && value !== null) value = sharedStringAt(sharedStrings, Number(value));
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

function resolveSheetPaths(files: Map<string, Uint8Array>): { name: string; path: string }[] {
  const workbook = xmlFile(files, 'xl/workbook.xml');
  const relationships = xmlFile(files, 'xl/_rels/workbook.xml.rels');
  const targets = new Map<string, string>();
  Array.from(relationships.getElementsByTagName('Relationship')).forEach((relation) => {
    const id = relation.getAttribute('Id');
    const target = relation.getAttribute('Target');
    if (id && target) targets.set(id, target);
  });
  return Array.from(workbook.getElementsByTagName('sheet')).flatMap((sheet) => {
    const name = sheet.getAttribute('name')?.trim() ?? '';
    const relationId = sheet.getAttribute('r:id') ?? sheet.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id');
    const target = relationId ? targets.get(relationId) : undefined;
    if (!name || !target) return [];
    const path = target.startsWith('/') ? target.slice(1) : target.startsWith('xl/') ? target : `xl/${target.replace(/^\.\//, '')}`;
    return [{ name, path }];
  });
}

function marker(value: CellValue): boolean | null {
  if (value === null || value === '') return false;
  if (typeof value === 'number') return value > 0;
  const normalized = String(value).trim().toLowerCase();
  if (!normalized || normalized === '0' || normalized === 'false') return false;
  if (['1', 'x', '✓', '✔', 'si', 'sí', 'true', 'c', 'nc', 'na', 'n/a', 'cumple', 'no cumple', 'no aplica'].includes(normalized)) return true;
  return null;
}

function makeRecords(criteria: Criterion[], recordStarts: number[], grid: SheetGrid): AuditRecord[] {
  return recordStarts.map((startColumn, index) => {
    const slot = index + 1;
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
}

function normalize(value: CellValue): string {
  return String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().trim();
}

function cpnRecordStarts(grid: SheetGrid): number[] {
  const starts: number[] = [];
  for (let column = 1; column <= 512; column += 1) {
    const statuses = [0, 1, 2].map((offset) => normalize(valueAt(grid, 10, column + offset)).replace(/[^A-Z]/g, ''));
    if (statuses[0] === 'C' && statuses[1] === 'NC' && statuses[2] === 'NA') starts.push(column);
  }
  const declared = starts.filter((column) => {
    const value = valueAt(grid, 5, column);
    return typeof value === 'number' && Number.isInteger(value) && value > 0;
  });
  if (declared.length && declared.every((column, index) => column === starts[index])) return declared;
  return starts;
}

function isCriteriaSummary(value: CellValue): boolean {
  const compact = normalize(value).replace(/[^A-Z0-9]+/g, ' ').trim();
  return compact === 'N DE CRITERIOS' || compact === 'NUMERO DE CRITERIOS';
}

function extractCpn(grid: SheetGrid, fileName: string): AuditModel {
  const title = String(valueAt(grid, 1, 2) ?? '').trim();
  if (!normalize(valueAt(grid, 10, 2)).includes('CRITERIOS DE EVALUACION')) {
    throw new Error('No reconocí la lista de criterios de la plantilla CPN.');
  }
  const recordStarts = cpnRecordStarts(grid);
  if (!recordStarts.length) throw new Error('No encontré los consecutivos de muestra ni las columnas C, NC y N/A en la hoja CPN.');

  const criteria: Criterion[] = [];
  let activeCategory = 'Sin clasificación';
  for (let row = 11; row <= 57; row += 1) {
    const rawCategory = valueAt(grid, row, 1);
    const rawText = valueAt(grid, row, 2);
    if (isCriteriaSummary(rawCategory) || isCriteriaSummary(rawText)) break;
    const text = typeof rawText === 'string' ? rawText.trim() : '';
    const category = typeof rawCategory === 'string' ? rawCategory.trim() : '';
    if (!text) {
      if (category) activeCategory = category;
      continue;
    }
    if (category) activeCategory = category;
    criteria.push({
      id: `CPN-${row}`,
      number: String(criteria.length + 1),
      text,
      sheetRow: row,
      category: activeCategory,
    });
  }
  if (!criteria.length) throw new Error('La hoja CPN no contiene criterios que se puedan leer.');
  const declaredCriteria = Number(valueAt(grid, 57, 2));
  if (Number.isInteger(declaredCriteria) && declaredCriteria > 0 && declaredCriteria !== criteria.length) {
    throw new Error(`La plantilla declara ${declaredCriteria} criterios, pero se pudieron leer ${criteria.length}. Revisa la versión del Excel.`);
  }

  const section: AuditSection = {
    id: 'CPN',
    name: 'Control prenatal',
    criteria,
    records: makeRecords(criteria, recordStarts, grid),
  };
  const version = fileName.match(/R-GCAL\d+-\d+/i)?.[0]?.toUpperCase() ?? 'CPN';
  return {
    title: title || 'Auditoría de historias clínicas · Control prenatal',
    instrumentName: 'Control prenatal',
    periodStart: '',
    periodEnd: '',
    samplingMethod: 'Muestra seleccionada por el auditor según protocolo institucional.',
    sourceVersion: version,
    scoring: { numerator: 'C', denominatorMarks: ['C', 'NC'], label: 'Cumple ÷ (Cumple + No cumple); N/A se excluye.' },
    sections: [section],
    updatedAt: new Date().toISOString(),
  };
}

function extractRcvProgram(grid: SheetGrid, id: 'DM' | 'HTA', name: string, lastCriterionRow: number): AuditSection {
  const criteria: Criterion[] = [];
  for (let row = 12; row <= lastCriterionRow; row += 1) {
    const rawText = valueAt(grid, row, 2);
    if (typeof rawText !== 'string' || !rawText.trim()) continue;
    const rawNumber = valueAt(grid, row, 1);
    criteria.push({
      id: `${id}-${row}`,
      number: rawNumber === null || rawNumber === '' ? '—' : String(rawNumber),
      text: rawText.trim(),
      sheetRow: row,
    });
  }
  if (!criteria.length) throw new Error(`La hoja ${id} no tiene criterios de auditoría.`);
  const recordStarts = Array.from({ length: 25 }, (_, index) => 3 + index * 3);
  return { id, name, criteria, records: makeRecords(criteria, recordStarts, grid) };
}

function extractRcv(files: Map<string, Uint8Array>, strings: Element[], paths: { name: string; path: string }[]): AuditModel {
  const dmPath = paths.find((sheet) => normalize(sheet.name) === 'DM');
  const htaPath = paths.find((sheet) => normalize(sheet.name) === 'HTA');
  if (!dmPath || !htaPath) throw new Error('No se encontraron las hojas DM y HTA de la plantilla R-GCAL101-76.');
  const included = (lastRow: number) => (row: number, column: number) => row >= 12 && row <= lastRow && column <= 78;
  const dmGrid = sheetGrid(xmlFile(files, dmPath.path), strings, included(39));
  const htaGrid = sheetGrid(xmlFile(files, htaPath.path), strings, included(43));
  const sections = [
    extractRcvProgram(dmGrid, 'DM', 'Diabetes mellitus tipo 2', 39),
    extractRcvProgram(htaGrid, 'HTA', 'Hipertensión arterial', 43),
  ];
  return {
    title: 'Auditoría de historias clínicas RCV',
    instrumentName: 'Riesgo cardiovascular (RCV)',
    periodStart: '',
    periodEnd: '',
    samplingMethod: 'Muestra seleccionada por el auditor según protocolo institucional.',
    sourceVersion: 'R-GCAL101-76',
    scoring: { numerator: 'C', denominatorMarks: ['C', 'NC'], label: 'Cumple ÷ (Cumple + No cumple); N/A se excluye.' },
    sections,
    updatedAt: new Date().toISOString(),
  };
}

export async function readAuditWorkbook(file: File): Promise<AuditModel> {
  if (!file.name.toLowerCase().endsWith('.xlsx')) throw new Error('Selecciona un archivo .xlsx.');
  const files = await readZip(await file.arrayBuffer());
  const strings = parseSharedStrings(files);
  const paths = resolveSheetPaths(files);
  if (paths.some((sheet) => normalize(sheet.name) === 'DM') && paths.some((sheet) => normalize(sheet.name) === 'HTA')) {
    return extractRcv(files, strings, paths);
  }

  const cpnSheet = paths.find((sheet) => normalize(sheet.name) === 'FORMATO FINAL') ?? paths[0];
  if (cpnSheet) {
    const cpnGrid = sheetGrid(xmlFile(files, cpnSheet.path), strings, (row, column) => {
      // Los renglones 6–9 de esta plantilla contienen datos identificables y no se extraen.
      const allowedRow = row === 1 || row === 5 || row === 10 || (row >= 11 && row <= 57);
      return allowedRow && column <= 512;
    });
    if (normalize(valueAt(cpnGrid, 1, 2)).includes('PRENATAL') || normalize(valueAt(cpnGrid, 10, 2)).includes('CRITERIOS DE EVALUACION')) {
      return extractCpn(cpnGrid, file.name);
    }
  }
  throw new Error('No reconocí esta plantilla. Por ahora Calaud admite R-GCAL101-76 (DM/HTA) y el registro CPN R-GCAL101-71.');
}
