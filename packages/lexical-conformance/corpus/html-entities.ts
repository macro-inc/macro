// Fixed HTML5 names from Python's standard library, values from pinned entities 6.

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { decodeHTML } from 'entities';

const names: string[] = JSON.parse(
  execFileSync(
    'python3',
    [
      '-c',
      'import html.entities,json; print(json.dumps(list(html.entities.html5)))',
    ],
    { encoding: 'utf8' }
  )
);
const entities = Object.fromEntries(
  names.map((name) => [name, decodeHTML('&' + name)])
);
const target = fileURLToPath(
  new URL(
    '../../../crates/client/lexical/macro_document_model/src/html/fragment/entities.json',
    import.meta.url
  )
);
const output = JSON.stringify(entities);
if (process.argv.includes('--check')) {
  if (readFileSync(target, 'utf8') !== output)
    throw Error('HTML entity source drift');
} else writeFileSync(target, output);
console.log(`Checked ${names.length} HTML entities`);
