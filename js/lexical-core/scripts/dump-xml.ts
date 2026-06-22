/**
 * Convert between Lexical JSON and XML.
 * Usage:
 *   bun run scripts/dump-xml.ts to-xml <lexical-json-file> <out-file>
 *   bun run scripts/dump-xml.ts to-lex <xml-file> <out-file>
 */

import { fromXml, toXml } from '../transformers/xml';

const [direction, path, outPath] = process.argv.slice(2);

if ((direction !== 'to-xml' && direction !== 'to-lex') || !path || !outPath) {
  console.error('Usage:');
  console.error('  bun run scripts/dump-xml.ts to-xml <lexical-json-file> <out-file>');
  console.error('  bun run scripts/dump-xml.ts to-lex <xml-file> <out-file>');
  process.exit(1);
}

const input = await Bun.file(path).text();

if (direction === 'to-xml') {
  await Bun.write(outPath, toXml(JSON.parse(input)));
} else {
  await Bun.write(outPath, JSON.stringify(fromXml(input), null, 2));
}
console.log(`wrote → ${outPath}`);
