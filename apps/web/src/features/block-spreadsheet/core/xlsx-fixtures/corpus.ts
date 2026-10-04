import { readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname } from 'node:path';
import { strFromU8, unzipSync } from 'fflate';
import { SaxesParser } from 'saxes';
import type {
  CalculatedCell,
  SpreadsheetCalculator,
  WorkbookCalculation,
} from '../calculation';
import type { WorkbookFileData } from '../workbook-file-types';

/** One real-world workbook and the provenance recorded in `manifest.json`. */
export type CorpusEntry = {
  file: string;
  title: string;
  source: string;
  license: string;
  /** Why recalculation is skipped, for workbooks the engine cannot finish. */
  skipCalculation?: string;
};

// jsdom tests have an http import.meta.url; resolve through Node instead.
const directory = `${dirname(
  createRequire(import.meta.url).resolve('./real-world/manifest.json')
)}/`;

export function corpusEntries(): CorpusEntry[] {
  const manifest: CorpusEntry[] = JSON.parse(
    readFileSync(`${directory}manifest.json`, 'utf8')
  );
  const files = readdirSync(directory).filter((name) => name.endsWith('.xlsx'));
  const listed = new Set(manifest.map((entry) => entry.file));
  const unlisted = files.filter((name) => !listed.has(name));
  if (unlisted.length)
    throw new Error(`Add provenance to manifest.json for ${unlisted}`);
  return manifest;
}

export function corpusBytes(entry: CorpusEntry): Uint8Array {
  return new Uint8Array(readFileSync(`${directory}${entry.file}`));
}

/** Excel's own cached result for a formula cell, read straight from the XML. */
export type CachedResult =
  | { kind: 'number'; value: number }
  | { kind: 'text'; value: string }
  | { kind: 'boolean'; value: boolean }
  | { kind: 'error'; value: string };

/** Formula cells and their cached results, keyed by sheet name then address. */
export function cachedFormulaResults(
  bytes: Uint8Array
): Map<string, Map<string, CachedResult>> {
  const files = unzipSync(bytes);
  const text = (path: string) => (files[path] ? strFromU8(files[path]) : '');
  const sheets: { name: string; id: string }[] = [];
  const workbook = new SaxesParser({ xmlns: true });
  workbook.on('opentag', (node) => {
    if (node.local !== 'sheet') return;
    const id = Object.values(node.attributes).find(
      (attribute) => attribute.local === 'id'
    )?.value;
    sheets.push({ name: node.attributes.name?.value ?? '', id: id ?? '' });
  });
  workbook.write(text('xl/workbook.xml')).close();
  const targets = new Map<string, string>();
  const relationships = new SaxesParser({ xmlns: true });
  relationships.on('opentag', (node) => {
    if (node.local !== 'Relationship') return;
    const target = node.attributes.Target?.value ?? '';
    targets.set(
      node.attributes.Id?.value ?? '',
      target.startsWith('/') ? target.slice(1) : `xl/${target}`
    );
  });
  relationships.write(text('xl/_rels/workbook.xml.rels')).close();
  const result = new Map<string, Map<string, CachedResult>>();
  for (const sheet of sheets) {
    const cells = new Map<string, CachedResult>();
    result.set(sheet.name, cells);
    const parser = new SaxesParser({ xmlns: true });
    let address = '';
    let type = '';
    let formula = false;
    let reading = false;
    let value = '';
    parser.on('opentag', (node) => {
      if (node.local === 'c') {
        address = node.attributes.r?.value ?? '';
        type = node.attributes.t?.value ?? 'n';
        formula = false;
        value = '';
      } else if (node.local === 'f') formula = true;
      else if (node.local === 'v') {
        reading = true;
        value = '';
      }
    });
    parser.on('text', (chunk) => {
      if (reading) value += chunk;
    });
    parser.on('closetag', (node) => {
      if (node.local === 'v') reading = false;
      if (node.local !== 'c' || !formula || !address) return;
      if (type === 'b')
        cells.set(address, { kind: 'boolean', value: value === '1' });
      else if (type === 'e') cells.set(address, { kind: 'error', value });
      else if (type === 'str' || type === 's' || type === 'inlineStr')
        cells.set(address, { kind: 'text', value });
      else if (value.trim() !== '')
        cells.set(address, { kind: 'number', value: Number(value) });
      else cells.set(address, { kind: 'text', value: '' });
    });
    parser.write(text(targets.get(sheet.id) ?? '')).close();
  }
  return result;
}

const VOLATILE =
  /\b(?:NOW|TODAY|RAND|RANDBETWEEN|RANDARRAY|OFFSET|INDIRECT|CELL|INFO)\s*\(/i;

function functionNames(formula: string): string[] {
  const names = new Set<string>();
  for (const match of formula
    .replace(/"(?:[^"]|"")*"/g, '""')
    .matchAll(/([A-Z][A-Z0-9.]*)\s*\(/gi))
    names.add(match[1].toUpperCase().replace(/^_XLFN\.(?:_XLWS\.)?/, ''));
  return [...names];
}

function sameResult(
  cached: CachedResult,
  calculated: CalculatedCell | undefined
) {
  const type = calculated?.type ?? 'blank';
  if (cached.kind === 'error') return calculated?.display === cached.value;
  if (cached.kind === 'boolean') return calculated?.value === cached.value;
  if (cached.kind === 'text')
    return cached.value === ''
      ? type === 'blank' ||
          calculated?.value === '' ||
          calculated?.display === ''
      : calculated?.value === cached.value;
  if (type === 'blank') return cached.value === 0;
  if (typeof calculated?.value !== 'number') return false;
  const difference = Math.abs(calculated.value - cached.value);
  return (
    difference <= 1e-9 ||
    difference <=
      1e-9 * Math.max(Math.abs(cached.value), Math.abs(calculated.value))
  );
}

export type CalculationFidelity = {
  /** Formula cells with a cached Excel result that Macro recalculated. */
  compared: number;
  matched: number;
  /** Formulas using volatile or environment-dependent functions. */
  volatile: number;
  /** Mismatches grouped by the functions their formulas use. */
  mismatchedFunctions: Record<string, number>;
  examples: string[];
};

/** Compare Macro's recalculation with the results Excel saved in the file. */
export function calculationFidelity(
  bytes: Uint8Array,
  workbook: WorkbookFileData,
  values: WorkbookCalculation
): CalculationFidelity {
  const cached = cachedFormulaResults(bytes);
  const fidelity: CalculationFidelity = {
    compared: 0,
    matched: 0,
    volatile: 0,
    mismatchedFunctions: {},
    examples: [],
  };
  workbook.sheets.forEach((sheet, index) => {
    const results = values[String(index)] ?? {};
    for (const [address, expected] of cached.get(sheet.name) ?? []) {
      const source = sheet.cells[address]?.value ?? '';
      if (!source.startsWith('=')) continue;
      if (VOLATILE.test(source)) {
        fidelity.volatile++;
        continue;
      }
      fidelity.compared++;
      if (sameResult(expected, results[address])) {
        fidelity.matched++;
        continue;
      }
      const names = functionNames(source);
      for (const name of names.length ? names : ['(no function)'])
        fidelity.mismatchedFunctions[name] =
          (fidelity.mismatchedFunctions[name] ?? 0) + 1;
      if (fidelity.examples.length < 8)
        fidelity.examples.push(
          `${sheet.name}!${address} ${source.slice(0, 80)} → Excel ${JSON.stringify(expected.value)}, Macro ${JSON.stringify(results[address]?.value ?? results[address]?.display ?? null)}`
        );
    }
  });
  return fidelity;
}

export function calculateImported(
  calculator: SpreadsheetCalculator,
  workbook: WorkbookFileData
): WorkbookCalculation {
  return calculator.calculateWorkbook(
    workbook.sheets.map((sheet, index) => ({
      id: String(index),
      name: sheet.name,
      cells: sheet.cells,
      rowCount: sheet.rowCount,
      metadata: sheet.metadata,
    })),
    { includeTypes: true }
  );
}
