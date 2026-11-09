import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import ts from 'typescript';

const root = resolve(import.meta.dirname, '../../..');
const upstream = join(root, 'target/lexical-upstream');
const pin: { version: string; sha256: string } = JSON.parse(
  readFileSync(join(root, 'packages/lexical-conformance/upstream.lock'), 'utf8')
);
const patch = createHash('sha256')
  .update(
    readFileSync(join(root, 'packages/lexical-conformance/record/hooks.patch'))
  )
  .digest('hex');
if (
  pin.version !== '0.45.0' ||
  readFileSync(join(upstream, '.recorder-pin'), 'utf8') !== pin.sha256 + patch
)
  throw new Error(
    'Prepare the checksum-pinned Lexical conformance sources first'
  );

const classes = new Map([
  ['RootNode', 'root'],
  ['HeadingNode', 'heading'],
  ['QuoteNode', 'quote'],
  ['CodeNode', 'code'],
  ['CodeHighlightNode', 'code-highlight'],
  ['ListNode', 'list'],
  ['ListItemNode', 'listitem'],
  ['LinkNode', 'link'],
  ['AutoLinkNode', 'autolink'],
  ['MarkNode', 'mark'],
  ['TableNode', 'table'],
  ['TableRowNode', 'tablerow'],
  ['TableCellNode', 'tablecell'],
]);
type Field = {
  id: number;
  name: string;
  className: string;
  typeName: string;
  property: string;
  sourceType: string;
  optional: boolean;
  derivedCache: boolean;
  source: string;
};
const fields: Field[] = [];
const found = new Set<string>();
function visit(directory: string) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.name === '__tests__' || entry.name === 'node_modules') continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      visit(path);
      continue;
    }
    if (!entry.name.endsWith('.ts') || entry.name.endsWith('.d.ts')) continue;
    const source = ts.createSourceFile(
      path,
      readFileSync(path, 'utf8'),
      ts.ScriptTarget.Latest,
      true
    );
    function node(value: ts.Node) {
      if (
        ts.isClassDeclaration(value) &&
        value.name &&
        classes.has(value.name.text)
      ) {
        const className = value.name.text;
        if (found.has(className))
          throw new Error(`Duplicate native class ${className}`);
        found.add(className);
        const typeName = classes.get(className);
        if (!typeName) throw new Error(`Missing native type ${className}`);
        const typeMethod =
          value.members.find(
            (member) =>
              ts.isMethodDeclaration(member) &&
              member.name.getText(source) === 'getType'
          ) ??
          value.members.find(
            (member) =>
              ts.isMethodDeclaration(member) &&
              member.name.getText(source) === '$config'
          );
        const returned =
          typeMethod && ts.isMethodDeclaration(typeMethod)
            ? typeMethod.body?.statements.find(ts.isReturnStatement)?.expression
            : undefined;
        const literal =
          returned && ts.isCallExpression(returned)
            ? returned.arguments[0]
            : returned;
        if (
          !literal ||
          !ts.isStringLiteral(literal) ||
          literal.text !== typeName
        )
          throw new Error(`Unexpected native type for ${className}`);
        for (const member of value.members) {
          if (
            !ts.isPropertyDeclaration(member) ||
            !ts.isIdentifier(member.name)
          )
            continue;
          const property = member.name.text;
          if (!property.startsWith('__')) continue;
          const field = property.slice(2);
          const name = className + field[0].toUpperCase() + field.slice(1);
          fields.push({
            id: 0,
            name,
            className,
            typeName,
            property,
            sourceType: member.type?.getText(source) ?? 'unknown',
            optional: Boolean(member.questionToken),
            derivedCache:
              className === 'RootNode' && property === '__cachedText',
            source: relative(upstream, path),
          });
        }
      }
      ts.forEachChild(value, node);
    }
    node(source);
  }
}
for (const directory of [
  'lexical',
  'lexical-rich-text',
  'lexical-code-core',
  'lexical-list',
  'lexical-link',
  'lexical-mark',
  'lexical-table',
])
  visit(join(upstream, 'packages', directory, 'src'));
for (const className of classes.keys())
  if (!found.has(className))
    throw new Error(`Missing native class ${className}`);
fields.sort((left, right) =>
  left.name < right.name ? -1 : left.name > right.name ? 1 : 0
);
const previousSchema = readFileSync(
  join(
    root,
    'crates/client/document_session_wasm/abi/foreign-native-fields.bop'
  ),
  'utf8'
);
const previousIds = new Map(
  [...previousSchema.matchAll(/^\s+(\w+) = (\d+);/gm)]
    .filter((match) => match[1] !== 'Unknown')
    .map((match) => [match[1], Number(match[2])])
);
let nextId = Math.max(0, ...previousIds.values()) + 1;
for (const field of fields) field.id = previousIds.get(field.name) ?? nextId++;
for (const name of previousIds.keys())
  if (!fields.some((field) => field.name === name))
    throw new Error(`Removed native field ${name}`);
fields.sort((left, right) => left.id - right.id);
const schema =
  '// Generated from checksum-pinned Lexical v0.45.0 native class property declarations.\n' +
  'enum ForeignNativeField : uint32 {\n  Unknown = 0;\n' +
  fields.map((field) => `  ${field.name} = ${field.id};`).join('\n') +
  '\n}\n';
const descriptors =
  '// Generated by scripts/generate-native-fields.ts; do not edit.\n' +
  `export const foreignNativeFields = ${JSON.stringify(fields, null, 2)} as const;\n`;
const rustDescriptors =
  '// Generated by scripts/generate-native-fields.ts; do not edit.\n' +
  'use crate::foreign_host_generated::ForeignNativeField;\n' +
  '/// Field ID, native type, JS property, source type and derived-cache marker.\n' +
  'pub const FOREIGN_NATIVE_FIELD_METADATA: &[(ForeignNativeField, &str, &str, &str, bool)] = &[\n' +
  fields
    .map(
      (field) =>
        `    (ForeignNativeField::${field.name}, ${JSON.stringify(field.typeName)}, ${JSON.stringify(field.property)}, ${JSON.stringify(field.sourceType)}, ${field.derivedCache}),`
    )
    .join('\n') +
  '\n];\n';
for (const [path, output] of [
  ['crates/client/document_session_wasm/abi/foreign-native-fields.bop', schema],
  [
    'crates/client/document_session_wasm/src/foreign_native_fields_generated.rs',
    rustDescriptors,
  ],
  [
    'packages/collaboration/src/session/foreign-native-fields.generated.ts',
    descriptors,
  ],
]) {
  const absolute = join(root, path);
  const generated = path.endsWith('.ts')
    ? execFileSync('bunx', ['biome', 'format', '--stdin-file-path', absolute], {
        cwd: join(root, 'packages/collaboration'),
        input: output,
        encoding: 'utf8',
      })
    : output;
  if (process.argv.includes('--check')) {
    if (readFileSync(absolute, 'utf8') !== generated)
      throw new Error(`Stale native field metadata: ${path}`);
  } else writeFileSync(absolute, generated);
}
console.log(
  `Derived ${fields.length} fields from ${found.size} pinned native classes`
);
