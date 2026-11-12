// Read-only generated-contract check. Supply actual paired five-file manifests.
// node input-commit-bindings.mjs <typescript.js> <ordinary-manifest> <compat-manifest>
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { dirname, isAbsolute, join } from 'node:path';
import { pathToFileURL } from 'node:url';

const [tsPath, ordinaryPath, compatPath] = process.argv.slice(2);
assert(tsPath && ordinaryPath && compatPath, 'actual TypeScript module and both generated manifests required');
const { default: ts } = await import(pathToFileURL(tsPath).href);
const policy = JSON.parse(await readFile(new URL('../src/input_commit/test/entry-policy.json', import.meta.url), 'utf8'));
const scopePolicy = JSON.parse(await readFile(new URL('../src/input_commit/test/scope-export-policy.json', import.meta.url), 'utf8'));
const sha = (value) => createHash('sha256').update(value).digest('hex');
async function load(manifestPath) {
  const raw = await readFile(manifestPath);
  let entries;
  if (raw.toString('utf8').trimStart().startsWith('{')) {
    entries = Object.entries(JSON.parse(raw).files);
  } else {
    entries = raw.toString('utf8').trim().split('\n').map((line) => {
      const match = /^([0-9a-f]{64}) [ *](.+)$/.exec(line);
      assert(match, 'actual sha256sum manifest line');
      return [match[2].replace(/^\.\//, ''), { sha256: match[1] }];
    });
  }
  const files = {};
  for (const [name, expected] of entries) {
    assert(!isAbsolute(name) && !name.split('/').includes('..'), 'manifest paths stay in their actual package');
    assert(!Object.hasOwn(files, name), 'manifest paths are unique');
    const bytes = await readFile(join(dirname(manifestPath), name));
    assert.equal(sha(bytes), expected.sha256, name);
    if (expected.bytes !== undefined) assert.equal(bytes.length, expected.bytes, name);
    files[name] = sha(bytes);
  }
  for (const name of ['document_session_wasm.js', 'document_session_wasm_bg.wasm', 'document_session_wasm.d.ts', 'document_session_wasm_bg.wasm.d.ts', 'package.json']) {
    assert(Object.hasOwn(files, name), `complete five-file package: ${name}`);
  }
  const text = await readFile(join(dirname(manifestPath), 'document_session_wasm.d.ts'), 'utf8');
  const source = ts.createSourceFile('actual-generated.d.ts', text, ts.ScriptTarget.Latest, true);
  assert.equal(source.parseDiagnostics.length, 0, 'generated declarations parse');
  const module = await import(pathToFileURL(join(dirname(manifestPath), 'document_session_wasm.js')).href);
  return { manifestSHA: sha(raw), files, source, module };
}
function declaration(binding, name, predicate) {
  return binding.source.statements.find((node) => predicate(node) && node.name?.text === name);
}
function nameOf(node, source) {
  if (node.name === undefined) return undefined;
  if (ts.isComputedPropertyName(node.name)) return node.name.getText(source);
  return node.name?.text;
}
const ordinary = await load(ordinaryPath);
const compat = await load(compatPath);
const editor = declaration(ordinary, 'EditorSession', ts.isClassDeclaration);
assert(editor, 'actual ordinary EditorSession declaration');
const methods = editor.members.filter(ts.isMethodDeclaration);
assert.deepEqual(methods.map((node) => nameOf(node, ordinary.source)).sort(),
  [...Object.values(policy).map((entry) => entry.jsName), 'free', '[Symbol.dispose]'].sort(),
  'all actual generated ordinary methods match the reviewed source policy plus generated destruction');
for (const method of methods) {
  const name = nameOf(method, ordinary.source);
  const receiver = method.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.StaticKeyword)
    ? ordinary.module.EditorSession : ordinary.module.EditorSession.prototype;
  const key = name === '[Symbol.dispose]' ? Symbol.dispose : name;
  assert.equal(typeof Object.getOwnPropertyDescriptor(receiver, key)?.value, 'function', `actual JS member ${name}`);
}
const observed = methods.find((node) => nameOf(node, ordinary.source) === 'inputObserved');
assert.equal(observed.parameters.length, 4);
assert.equal(observed.parameters[3].type.kind, ts.SyntaxKind.StringKeyword, 'full canonical string, no bigint input truncation');
assert.equal(observed.type.kind, ts.SyntaxKind.NumberKeyword);
const read = methods.find((node) => nameOf(node, ordinary.source) === 'readInputCommitReceipt');
assert.equal(read.parameters[0].type.kind, ts.SyntaxKind.StringKeyword);
assert.equal(read.type.getText(ordinary.source), 'InputCommitReceipt');
const receipt = declaration(ordinary, 'InputCommitReceipt', ts.isClassDeclaration);
assert(receipt && typeof ordinary.module.InputCommitReceipt === 'function');
for (const [name, expected] of Object.entries({ entryId: 'bigint', mainKind: 'InputCommitKind', commitId: 'bigint | undefined', mainHandled: 'boolean | undefined' })) {
  const member = receipt.members.find((node) => nameOf(node, ordinary.source) === name);
  assert(member?.type, `actual primitive receipt getter ${name}`);
  assert.equal(member.type.getText(ordinary.source), expected);
  assert.equal(typeof Object.getOwnPropertyDescriptor(ordinary.module.InputCommitReceipt.prototype, name)?.get, 'function');
}
assert(declaration(ordinary, 'InputCommitKind', ts.isEnumDeclaration));
const compatEditor = declaration(compat, 'EditorSession', ts.isClassDeclaration);
assert(compatEditor, 'actual compatibility class');
for (const name of ['inputObserved', 'readInputCommitReceipt']) {
  assert(!compatEditor.members.some((node) => nameOf(node, compat.source) === name), `no compat declaration stub ${name}`);
  assert(!Object.hasOwn(compat.module.EditorSession.prototype, name), `no compat JS stub ${name}`);
}
for (const name of ['InputCommitReceipt', 'InputCommitKind']) {
  assert(!declaration(compat, name, (node) => ts.isClassDeclaration(node) || ts.isEnumDeclaration(node)));
  assert(!Object.hasOwn(compat.module, name), `no compat class/enum stub ${name}`);
}
// Presence is only an issued-callback scope capability. It grants no ordinary
// receiver, compatibility observation or receipt authority.
for (const [rustName, entry] of Object.entries(scopePolicy)) {
  assert.equal(entry.policy, 'issued-view-command-scope-only', rustName);
  for (const [profile, binding] of [['ordinary', ordinary], ['compatibility', compat]]) {
    const fn = declaration(binding, entry.jsName, ts.isFunctionDeclaration);
    if (entry[profile]) {
      assert(fn, `${profile} actual generated scope declaration ${entry.jsName}`);
      assert.equal(typeof binding.module[entry.jsName], 'function', `${profile} actual scope export ${entry.jsName}`);
    } else {
      assert(!fn, `${profile} scope declaration absent ${entry.jsName}`);
      assert(!Object.hasOwn(binding.module, entry.jsName), `${profile} scope export absent ${entry.jsName}`);
    }
  }
}
process.stdout.write(`${JSON.stringify({ status: 'pass', ordinary: { manifestSHA: ordinary.manifestSHA, files: ordinary.files, methods: methods.length }, compatibility: { manifestSHA: compat.manifestSHA, files: compat.files, observedCapability: 'absent; consumer must explicitly report Unavailable' } })}\n`);
