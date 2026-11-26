/**
 * Compares two results files of run.ts step by step, and warns where they
 * cannot be compared, such as a channel step that opened different channels.
 *
 *   bun scripts/android-benchmark/compare.ts <a.json> <b.json>
 *
 * See README.md in this directory.
 */
import { readFile } from 'node:fs/promises';
import { compareRuns, type Results } from './comparison';

const [fileA, fileB] = process.argv.slice(2);
if (!fileA || !fileB) {
  console.error('Usage: compare.ts <a.json> <b.json>');
  process.exit(2);
}
const read = async (file: string) =>
  JSON.parse(await readFile(file, 'utf8')) as Results;
const [a, b] = await Promise.all([read(fileA), read(fileB)]);
const { steps, warnings } = compareRuns(a, b);

const fmt = (value: number) => (Number.isNaN(value) ? '-' : String(Math.round(value)));
const header = ['scenario', 'variant', 'cpu', 'A n', 'A median', 'B n', 'B median', 'change', 'detect'];
const lines = steps.map((step) => [
  `${step.scenario}${step.differentTargets || step.differentReadiness ? ' !' : ''}`,
  step.variant,
  `${step.cpuThrottle}×`,
  String(step.a.n),
  fmt(step.a.median),
  String(step.b.n),
  fmt(step.b.median),
  Number.isNaN(step.change) ? '-' : `${step.change >= 0 ? '+' : ''}${(step.change * 100).toFixed(0)}%`,
  // The larger run's detectable change, as a share of A's median.
  `${((Math.max(step.a.detect, step.b.detect) / step.a.median) * 100).toFixed(0)}%`,
]);
const widths = header.map((title, column) =>
  Math.max(title.length, ...lines.map((line) => line[column].length))
);
const render = (line: string[]) =>
  line.map((cell, column) => (column < 2 ? cell.padEnd(widths[column]) : cell.padStart(widths[column]))).join('  ');
console.log(`A: ${fileA} (${a.meta.environment?.app ?? 'unknown app'}${a.meta.label ? `, ${a.meta.label}` : ''})`);
console.log(`B: ${fileB} (${b.meta.environment?.app ?? 'unknown app'}${b.meta.label ? `, ${b.meta.label}` : ''})`);
console.log(render(header));
for (const line of lines) console.log(render(line));
console.log('Times in ms. detect is the larger run\'s detectable change as a share of A\'s median; smaller changes are noise.');
for (const warning of warnings) console.warn(`Warning: ${warning}`);
if (steps.some((step) => step.differentTargets || step.differentReadiness))
  console.warn('Rows marked ! opened different targets, or ended at different points, in A and B.');
