// Actual source HTML route, node exports and htmlparser2/linkedom fragment goldens.
import { mock, setSystemTime } from 'bun:test';
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { parseHTML } from 'linkedom';

const root = fileURLToPath(new URL('../../../', import.meta.url));
setSystemTime(new Date('2026-11-07T12:00:00Z'));
mock.module(
  createRequire(root + 'packages/lexical-core/nodes/AwaitNode.ts').resolve(
    'nanoid'
  ),
  () => ({ nanoid: (size = 21) => 'u'.repeat(size) })
);
await import(root + 'services/lexical-service/src/polyfills/prism.ts');
const { markdownToHtml } = await import(
  root + 'services/lexical-service/src/lib/html.ts'
);
const { createHeadlessEditor } = await import(
  root + 'node_modules/@lexical/headless/dist/LexicalHeadless.node.mjs'
);
const { $generateHtmlFromNodes } = await import(
  root + 'node_modules/@lexical/html/dist/LexicalHtml.node.mjs'
);
const { $getRoot, resetRandomKey } = await import(
  root + 'node_modules/lexical/dist/Lexical.node.mjs'
);
const { SupportedNodeTypes, NodeReplacements } = await import(
  root + 'packages/lexical-core/node-list.ts'
);
const dom = parseHTML('<!doctype html><html><body></body></html>');
Object.assign(globalThis, {
  window: dom.window,
  document: dom.document,
  DOMParser: dom.DOMParser,
  MutationObserver: dom.MutationObserver,
  HTMLElement: dom.window.HTMLElement,
  DocumentFragment: dom.window.DocumentFragment,
  Text: dom.window.Text,
  Node: dom.window.Node,
});
const rows = [];
function add(kind, name, input, f, profile = undefined) {
  let expected;
  try {
    expected = { value: f() };
  } catch (error) {
    expected = { throws: true };
    if (process.argv.includes('--debug')) console.error(name, String(error));
  }
  rows.push(JSON.stringify({ kind, name, input, profile, expected }));
}
const markdown = [
  '',
  ' ',
  '\ufeff\n',
  '# Title\n\nText **bold** *italic* ~~strike~~ `code` 😀',
  '- one\n- two',
  '1. one\n2. two',
  '- [ ] one\n- [x] two',
  '- one\n  - nested\n    - deeper',
  '3. three\n   - nested',
  '> quote\n> **bold**',
  '```rust\nlet x = 1;\n```',
  '---',
  '[link](https://example.com/?a=1&b=2)',
  'line  \nbreak\n\nlast',
  '| A | B |\n| --- | --- |\n| C | D |',
  '$x^2$',
  '$$\nx+1\n$$',
  '<m-user-mention>{"userId":"user-one","email":"user@example.com","displayName":"Reader"}</m-user-mention>',
];
// Every recorded source conversion input/output is also an HTML-route case.
const conversions = readFileSync(
  root +
    'crates/client/lexical/macro_document_model/tests/corpus/conversions.jsonl',
  'utf8'
)
  .trimEnd()
  .split('\n')
  .map(JSON.parse);
const markdownInputs = new Set(markdown);
for (const row of conversions) {
  markdownInputs.add(row.input);
  if (typeof row.markdown === 'string') markdownInputs.add(row.markdown);
}
for (const value of [
  '# Title\n\nSome **bold** text.\n',
  'A [runbook](https://macro.com/runbook).',
  '| a | b |\n| - | - |\n| 1 | 2 |\n',
  '& < > " \' \u00a0',
  '[link](javascript:alert(1))',
  '[link](https://example.com/ \"<&>\")',
  'https://example.com user@example.com',
  '$é$',
])
  markdownInputs.add(value);
for (const url of [
  'https://example.com/%C3%A9',
  'https://example.com/%E9',
  'https://example.com/%ZZ',
  'https://example.com/%2F%23%3f%25',
])
  markdownInputs.add(`[link](${url})`);
for (let level = 1; level <= 6; level++)
  markdownInputs.add('#'.repeat(level) + ' heading');
for (const input of markdownInputs)
  add('markdown', `markdown:${rows.length}`, input, () => {
    globalThis.window = undefined;
    return markdownToHtml(input);
  });
const nodes = readFileSync(
  root + 'crates/client/lexical/macro_document_model/tests/corpus/nodes.jsonl',
  'utf8'
)
  .trimEnd()
  .split('\n')
  .map(JSON.parse);
// Q7 control: Latin-1 must retain btoa's single-byte encoding.
for (const node of nodes.filter((node) =>
  node.name.startsWith('equation:equation-unicode:')
)) {
  const input = JSON.parse(
    JSON.stringify(node.input).replace(
      JSON.stringify('é 😀 <&> "'),
      JSON.stringify('é')
    )
  );
  nodes.push({
    ...node,
    name: node.name.replace('equation-unicode', 'latin1'),
    input,
  });
}
for (const node of nodes)
  add(
    'node',
    node.name,
    node.input,
    () => {
      resetRandomKey();
      globalThis.window = undefined;
      const editor = createHeadlessEditor({
        nodes: [
          ...SupportedNodeTypes,
          ...(node.profile === 'headless' ? NodeReplacements : []),
        ],
        onError: (e) => {
          throw e;
        },
      });
      editor.setEditorState(editor.parseEditorState(node.input));
      globalThis.window = dom.window;
      return editor.read(() => ({
        html: $generateHtmlFromNodes(editor),
        text: $getRoot().getTextContent(),
      }));
    },
    node.profile
  );
const fragments = [
  '',
  'text &amp; &nbsp; &#x1f600;',
  '<div A=1 B=2 class=" a  a b ">x</div>',
  '<svg><path d="x"/></svg>',
  '<p>a<br></br>b</p>',
  '<!doctype html><p>x',
  '<template>x</template>z',
  '<script>a < b && c > d</script>',
  '<textarea>&amp;<x></textarea>',
  '<!--x--!>tail-->',
  '<![CDATA[x]]>',
  '<?xml version="1.0"?><div/>',
  '<div><p>x</div>',
  '<svg/><math><mi>x</mi></math>',
  '<div title="&notit; &not= &not; &copy &#128; &#0;">&notit; &not= &not;</div>',
];
for (const input of [
  '<',
  '</',
  '<a',
  '<a ',
  '<a x',
  '<a x=',
  '<a x="',
  '<a x="v',
  '<a x=v',
  '<a/',
  '<a /',
  '<a /x>',
  '</a',
  '</',
  '<!--',
  '<!-->',
  '<!--->',
  '<!--x',
  '<!--x--',
  '<!doctype',
  '<!DOCTYPE html PUBLIC "pub" "sys"><p>x',
  '<!doctype html SYSTEM "sys">',
  '<!doctype HTML garbage>',
  '<?',
  '<![CDATA[',
  '<![CDATA[x]]>',
  '<>',
  '<1>',
  '</1>',
  '<svg viewBox="1"><linearGradient/></svg>',
  '<div __proto__=one constructor=two toString=three></div>',
])
  fragments.push(input);
const entityNames = Object.keys(
  JSON.parse(
    readFileSync(
      root +
        'crates/client/lexical/macro_document_model/src/html/fragment/entities.json',
      'utf8'
    )
  )
);
for (const name of entityNames)
  fragments.push('&' + name, `<a title="&${name}x &${name}= &${name}">x</a>`);
fragments.push(
  '<![CDATA[x>y]]>',
  '<![CDATA[x',
  '<?doctype html>',
  '<!doctypehtml>',
  '<!DOCTYPE html public "pub" "sys">',
  '<xmp>&amp;<div></xmp>',
  '<svg><xmp>&amp;<div></xmp></svg>'
);
const tokens = [
  '<div A=1 B="&quot;">',
  '</div>',
  '<p>',
  '</p>',
  '<span>',
  '</span>',
  '<table>',
  '<td>',
  '<tr>',
  '</table>',
  '<li>',
  '<ul>',
  '</ul>',
  '<svg>',
  '<path/>',
  '</svg>',
  '<foreignObject>',
  '</foreignObject>',
  '<template>',
  '</template>',
  '<br/>',
  '</br>',
  '<script>',
  '</script>',
  '<style>',
  '</style>',
  '<textarea>',
  '</textarea>',
  '<title>',
  '</title>',
  '<!--x-->',
  '<!--x--!>',
  '<',
  '>',
  '&amp;',
  '&notit;',
  '&#xD800;',
  '😀',
  '<&>',
  '\u0000',
  'x',
  '<a a=1 a=2 A=3>',
  '</a>',
  '<!doctype HTML>',
  '<![CDATA[x]]>',
  '<?x>',
];
let seed = 0x53771531;
function random() {
  seed ^= seed << 13;
  seed ^= seed >>> 17;
  seed ^= seed << 5;
  return seed >>> 0;
}
for (let n = 0; n < 3000; n++) {
  let s = '';
  for (let k = 0, limit = 1 + (random() % 16); k < limit; k++)
    s += tokens[random() % tokens.length];
  fragments.push(s);
}
for (const input of fragments)
  add('fragment', `fragment:${rows.length}`, input, () => {
    const template = dom.document.createElement('template');
    template.innerHTML = input;
    return template.innerHTML;
  });
const target =
  root + 'crates/client/lexical/macro_document_model/tests/corpus/html.jsonl';
const output = rows.join('\n') + '\n';
if (process.argv.includes('--check')) {
  if (readFileSync(target, 'utf8') !== output)
    throw Error('HTML source oracle drift');
} else writeFileSync(target, output);
console.log(`Checked ${rows.length} source HTML cases`);
