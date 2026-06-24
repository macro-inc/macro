/**
 * Convert Lexical JSON to XML.
 * Usage:
 *   bun run scripts/dump-xml.ts <lexical-json-file> <out-file>
 */

import { toXml } from '../transformers/xml';

const [path, outPath] = process.argv.slice(2);

if (!path || !outPath) {
  console.error('Usage:');
  console.error('  bun run scripts/dump-xml.ts <lexical-json-file> <out-file>');
  process.exit(1);
}

const input = await Bun.file(path).text();
await Bun.write(outPath, toXml(JSON.parse(input)));
console.log(`wrote → ${outPath}`);
