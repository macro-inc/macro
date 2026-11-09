import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { EDITOR_PLUGIN_BEHAVIORS } from './editor-plugin-behaviors';

// This is a source ledger, not a coverage oracle. A test importing a module
// does not prove that every branch or UI behavior in that module is covered.
const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const EDITOR_ROOT = 'apps/web/src/lib/core/component/LexicalMarkdown/';
const SCOPES = [
  EDITOR_ROOT,
  'apps/web/src/features/block-md/',
  'packages/lexical-core/',
  'apps/web/src/lib/core/comments/',
  'apps/web/src/lib/core/messages/',
  'apps/web/src/features/channel/Input/',
  'apps/web/src/features/task-composer/',
  'apps/web/src/features/document-composer/',
  'apps/web/src/features/email-compose/',
  'apps/web/src/features/email-thread/',
  'apps/web/src/features/block-canvas/primitives/text-lexical',
  'apps/web/src/features/block-canvas/text-editing',
  'apps/web/src/features/block-agent/',
  'apps/web/src/features/agents-view/',
  'apps/web/src/features/universal-input/',
  'apps/web/src/features/scheduling/primitives/create-event-editor',
];
const REGISTRATIONS = new Set([
  'registerCommand',
  'registerNodeTransform',
  'registerMutationListener',
  'registerRootListener',
  'registerUpdateListener',
  'registerEditableListener',
  'registerTextContentListener',
  'registerDecoratorListener',
]);
const MOUNTS = new Set([
  'createLexicalWrapper',
  'createEditor',
  'buildHandle',
  'buildChatEditor',
  'MarkdownTextarea',
  'MarkdownShell',
  'ComposerEditor',
  'StaticMarkdown',
  'StaticLexical',
  'CollabMarkdownEditor',
  'ContentEditable',
]);

type Site = {
  category: string;
  source: string;
  line: number;
  behavior: string;
  relatedTests: string[];
};
type Source = { path: string; text: string; ast: ts.SourceFile };

function compact(value: string) {
  return value.replace(/\s+/g, ' ').trim();
}

function nameOf(expression: ts.Expression) {
  if (ts.isIdentifier(expression)) return expression.text;
  if (ts.isPropertyAccessExpression(expression)) return expression.name.text;
  return '';
}

function isTest(path: string) {
  return /\.(test|spec|e2e)\.[cm]?[jt]sx?$/.test(path);
}

function isFixture(path: string) {
  return (
    /\/(browser-test|fuzz|behavior-inventory|tests|__tests__|scripts|generated)\//.test(
      path
    ) || /(?:TestPage|Demo|\.config)\./.test(path)
  );
}

function resolveImport(path: string, specifier: string, paths: Set<string>) {
  let base: string;
  if (specifier.startsWith('.')) base = resolve(ROOT, dirname(path), specifier);
  else if (specifier.startsWith('@core/'))
    base = resolve(ROOT, 'apps/web/src/lib/core', specifier.slice(6));
  else if (specifier === '@macro-inc/lexical-core')
    base = resolve(ROOT, 'packages/lexical-core/index');
  else if (specifier.startsWith('@macro-inc/lexical-core/'))
    base = resolve(ROOT, 'packages/lexical-core', specifier.slice(24));
  else return;
  for (const suffix of ['', '.ts', '.tsx', '/index.ts', '/index.tsx']) {
    const path = relative(ROOT, base + suffix);
    if (paths.has(path)) return path;
  }
}

async function sources(): Promise<Source[]> {
  const paths: string[] = [];
  for (const pattern of [
    'apps/web/src/**/*.{ts,tsx}',
    'packages/lexical-core/**/*.{ts,tsx}',
  ]) {
    for await (const path of new Bun.Glob(pattern).scan({
      cwd: ROOT,
      onlyFiles: true,
    }))
      paths.push(path);
  }
  return Promise.all(
    paths
      .filter(
        (path) =>
          path.startsWith('apps/web/src/') ||
          path.startsWith('packages/lexical-core/')
      )
      .sort()
      .map(async (path) => {
        const text = await readFile(resolve(ROOT, path), 'utf8');
        return {
          path,
          text,
          ast: ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true),
        };
      })
  );
}

export function escapeCell(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('|', '&#124;')
    .replaceAll('\n', ' ');
}

type AddSite = (node: ts.Node, category: string, behavior: string) => void;

function collectCallSite(
  node: ts.CallExpression,
  ast: ts.SourceFile,
  add: AddSite
) {
  const name = nameOf(node.expression);
  const first = node.arguments[0]?.getText(ast) ?? '';
  if (REGISTRATIONS.has(name)) {
    const priority = node.arguments[2]?.getText(ast) ?? '';
    add(
      node,
      name === 'registerCommand' ? 'commands' : 'lifecycle',
      `${name}(${first}) ${priority}`
    );
  } else if (
    name === 'registerInlineMenuTrigger' ||
    name === 'registerMarkdownShortcuts'
  ) {
    add(node, 'triggers', node.getText(ast));
  } else if (name === 'addEventListener') {
    add(
      node,
      'events',
      `${node.expression.getText(ast)}(${first}, ${node.arguments[1]?.getText(ast) ?? ''})`
    );
  } else if (
    name === 'registerHistory' ||
    name === 'registerPlainText' ||
    name === 'registerRichText' ||
    name === 'registerList'
  ) {
    add(node, 'presets', node.getText(ast));
  } else if (MOUNTS.has(name)) {
    add(node, 'surfaces', node.getText(ast));
  }
}

async function main() {
  const output = process.argv[2];
  if (!output)
    throw new Error(
      'Usage: bun scripts/editor-behavior-inventory.ts <output-directory>'
    );
  const all = await sources();
  const paths = new Set(all.map((source) => source.path));
  const imports = new Map<string, string[]>();
  for (const source of all.filter((source) => isTest(source.path))) {
    for (const statement of source.ast.statements) {
      if (
        !ts.isImportDeclaration(statement) ||
        !ts.isStringLiteral(statement.moduleSpecifier)
      )
        continue;
      const target = resolveImport(
        source.path,
        statement.moduleSpecifier.text,
        paths
      );
      if (!target) continue;
      const tests = imports.get(target) ?? [];
      tests.push(source.path);
      imports.set(target, tests);
    }
  }
  const sites: Site[] = [];
  const scanned: { path: string; sha256: string }[] = [];
  for (const source of all) {
    if (isTest(source.path) || isFixture(source.path)) continue;
    const scoped = SCOPES.some((scope) => source.path.startsWith(scope));
    const surface =
      /(?:LexicalMarkdown|lexical-core|\bMarkdownShell\b|\bMarkdownTextarea\b|\bcreateLexicalWrapper\b)/.test(
        source.text
      );
    if (!scoped && !surface) continue;
    // Native adapter implementations aren't today's flag-OFF plugin behavior.
    if (
      /\/(?:native|nativeGeometry)\.tsx?$/.test(source.path) ||
      source.path.includes('/plugins/group-b/')
    )
      continue;
    scanned.push({
      path: source.path,
      sha256: createHash('sha256').update(source.text).digest('hex'),
    });
    const add = (node: ts.Node, category: string, behavior: string) => {
      sites.push({
        category,
        source: source.path,
        line:
          source.ast.getLineAndCharacterOfPosition(node.getStart(source.ast))
            .line + 1,
        behavior: compact(behavior),
        relatedTests: imports.get(source.path) ?? [],
      });
    };
    if (
      source.path.startsWith(`${EDITOR_ROOT}plugins/`) &&
      /Plugin\.tsx?$/.test(source.path)
    ) {
      const plugin = source.path
        .slice(`${EDITOR_ROOT}plugins/`.length)
        .split('/')[0];
      const behavior = EDITOR_PLUGIN_BEHAVIORS[plugin];
      if (!behavior)
        throw new Error(
          `Add a reviewed behavior description for ${source.path}`
        );
      const entry = source.ast.statements.find(
        (statement) =>
          ts.isFunctionDeclaration(statement) &&
          statement.name?.text.endsWith('Plugin') &&
          statement.modifiers?.some(
            (modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword
          )
      );
      add(entry ?? source.ast, 'plugins', behavior);
    }
    function visit(node: ts.Node) {
      if (ts.isCallExpression(node)) collectCallSite(node, source.ast, add);
      if (scoped && ts.isIfStatement(node)) {
        add(
          node,
          'guards',
          `if (${node.expression.getText(source.ast)}) ${node.thenStatement.getText(source.ast)}`
        );
      }
      if (scoped && ts.isCaseClause(node)) {
        add(
          node,
          'branches',
          `case ${node.expression.getText(source.ast)}: ${node.statements.map((statement) => statement.getText(source.ast)).join(' ')}`
        );
      }
      if (scoped && ts.isPropertyAssignment(node)) {
        const key = node.name.getText(source.ast);
        if (
          [
            'regExp',
            'regExpStart',
            'regExpEnd',
            'tag',
            'trigger',
            'label',
            'test',
          ].includes(key)
        ) {
          add(node, 'shortcuts-and-transformers', node.getText(source.ast));
        }
      }
      if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
        const name = node.tagName.getText(source.ast);
        if (MOUNTS.has(name)) add(node, 'surfaces', node.getText(source.ast));
      }
      if (scoped && ts.isJsxAttribute(node)) {
        const name = node.name.getText(source.ast);
        if (
          /^on(?::|[A-Z])|^aria-|^role$|^contentEditable$|^tabIndex$|^draggable$|^inert$/.test(
            name
          )
        ) {
          add(
            node,
            name.startsWith('on') ? 'events' : 'accessibility',
            node.getText(source.ast)
          );
        }
      }
      ts.forEachChild(node, visit);
    }
    visit(source.ast);
  }
  const categories = [...new Set(sites.map((site) => site.category))].sort();
  await mkdir(output, { recursive: true });
  const counts: Record<string, number> = {};
  for (const category of categories) {
    const rows = sites.filter((site) => site.category === category);
    counts[category] = rows.length;
    const lines = [
      `# Editor source ledger: ${category}`,
      '',
      'Source sites are review obligations, not a deduplicated count of user behaviors.',
      'Direct-import tests are pointers only: sufficiency and flag-ON execution remain unverified.',
      '',
      '| Behavior / exact source condition | Source file:line | Existing direct-import tests | Status |',
      '| --- | --- | --- | --- |',
      ...rows.map(
        (site) =>
          `| <code>${escapeCell(site.behavior)}</code> | ${site.source}:${site.line} | ${site.relatedTests.join('<br>') || 'None found'} | ${site.relatedTests.length ? 'Related test; ON pending' : 'Unpinned; ON pending'} |`
      ),
      '',
    ];
    await writeFile(resolve(output, `${category}.md`), lines.join('\n'));
  }
  const manifest = {
    schemaVersion: 1,
    engine: 'OFF-source',
    scopes: SCOPES,
    sourceFingerprint: createHash('sha256')
      .update(JSON.stringify(scanned))
      .digest('hex'),
    sourceFiles: scanned,
    counts,
    totalSites: sites.length,
    relatedTestSites: sites.filter((site) => site.relatedTests.length).length,
    verifiedOn: 0,
    sites,
  };
  await writeFile(
    resolve(output, 'source-ledger.json'),
    `${JSON.stringify(manifest, null, 2)}\n`
  );
  const summary = [
    '# Editor source ledger',
    '',
    `Source fingerprint: ${manifest.sourceFingerprint}`,
    '',
    `${scanned.length} source files; ${sites.length} source sites; ${manifest.relatedTestSites} have a directly importing test; 0 verified ON.`,
    '',
    'A registration, a conditional guard and an event handler can describe the same behavior.',
    'Do not present site counts or direct-import links as proven behavioral coverage.',
    '',
    '| Category | Source sites |',
    '| --- | --- |',
    ...categories.map(
      (category) => `| [${category}](${category}.md) | ${counts[category]} |`
    ),
    '',
    'The complete machine-readable table and content hashes are in [source-ledger.json](source-ledger.json).',
    '',
  ];
  await writeFile(resolve(output, 'README.md'), summary.join('\n'));
  console.log(
    JSON.stringify({
      sourceFiles: scanned.length,
      counts,
      totalSites: sites.length,
      relatedTestSites: manifest.relatedTestSites,
      verifiedOn: 0,
    })
  );
}

if (import.meta.main) await main();
