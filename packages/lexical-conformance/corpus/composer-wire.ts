// Generate endpoint mirrors from the server domain: source accepts string IDs/times.

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../../', import.meta.url));
let source = readFileSync(root + 'crates/trigger_context/src/lib.rs', 'utf8');
source = source.slice(source.indexOf('/// What happened'));
for (;;) {
  const match = /^impl [^{]+\{/m.exec(source);
  if (!match) break;
  let end = match.index + match[0].length,
    depth = 1;
  while (depth) {
    if (end >= source.length)
      throw Error('Unbalanced server domain implementation');
    depth += Number(source[end] === '{') - Number(source[end] === '}');
    end++;
  }
  source = source.slice(0, match.index) + source.slice(end);
}
source = source
  .replaceAll('DateTime<Utc>', 'String')
  .replaceAll('Uuid', 'String')
  .replaceAll('BotId', 'String');
source = source.replace(
  /#\[serde\(default, skip_serializing_if = "Vec::is_empty"\)\]\n(\s*)(pub )?(\w+): Vec<([^\n]+)>,/g,
  '#[serde(default, skip_serializing_if="Option::is_none")]\n$1$2$3: Option<Vec<$4>>,'
);
source = source.replace(
  /^(\s*)(pub )?(\w+): Option</gm,
  (all, space, _pub, name) =>
    ['payload', 'from_bot'].includes(name)
      ? all
      : `${space}#[serde(deserialize_with="crate::wire::non_null_option")]\n${all}`
);
source = source.replaceAll(
  'message: Option<ContextMessage>',
  'message: Option<Box<ContextMessage>>'
);
source =
  '//! Endpoint mirror: IDs and time facts preserve wire spelling before rendering.\n//! Generated from trigger_context by corpus/composer-wire.ts; do not edit.\nuse serde::{Deserialize,Serialize};\nuse serde_json::Value;\n' +
  source;
const output = execFileSync(
  'rustfmt',
  ['--edition', '2024', '--emit', 'stdout'],
  { input: source, encoding: 'utf8' }
);
const target = root + 'crates/macro_document_composers/src/wire_trigger.rs';
if (process.argv.includes('--check')) {
  if (readFileSync(target, 'utf8') !== output)
    throw Error('Composer wire mirror drift');
} else writeFileSync(target, output);
console.log('Checked server trigger endpoint mirror');
