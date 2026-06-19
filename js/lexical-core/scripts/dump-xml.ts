/**
 * Convert between Lexical JSON and XML.
 * Usage:
 *   bun run scripts/dump-xml.ts to-xml <lexical-json-file> <out-file> [--algo manual|transformer]
 *   bun run scripts/dump-xml.ts to-lex <xml-file> <out-file> [--algo manual|transformer]
 */

import { toXml as toXmlManual, fromXml as fromXmlManual } from '../transformers/xml-manual';
import { toXml as toXmlTransformer, fromXml as fromXmlTransformer } from '../transformers/xml-transformer';

const args = process.argv.slice(2);
const algoIdx = args.indexOf('--algo');
const algo = algoIdx !== -1 ? args.splice(algoIdx, 2)[1] : 'manual';
const [direction, path, outPath] = args;

if ((direction !== 'to-xml' && direction !== 'to-lex') || !path || !outPath) {
  console.error('Usage:');
  console.error('  bun run scripts/dump-xml.ts to-xml <lexical-json-file> <out-file> [--algo manual|transformer]');
  console.error('  bun run scripts/dump-xml.ts to-lex <xml-file> <out-file> [--algo manual|transformer]');
  process.exit(1);
}

if (algo !== 'manual' && algo !== 'transformer') {
  console.error(`Unknown --algo "${algo}", expected manual or transformer`);
  process.exit(1);
}

const toXml = algo === 'transformer' ? toXmlTransformer : toXmlManual;
const fromXml = algo === 'transformer' ? fromXmlTransformer : fromXmlManual;

const input = await Bun.file(path).text();

if (direction === 'to-xml') {
  await Bun.write(outPath, toXml(JSON.parse(input)));
} else {
  await Bun.write(outPath, JSON.stringify(fromXml(input), null, 2));
}
console.log(`wrote → ${outPath} (algo: ${algo})`);
