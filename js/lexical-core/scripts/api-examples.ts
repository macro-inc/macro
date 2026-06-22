#!/usr/bin/env bun
// One-off: build a doc, run `editor` code through the real queue/Doc pipeline,
// and print the resulting XML. Generates the worked examples in
// ai-editing/prompts/API.md. Node ids are normalized (b1/t1…) in both the code
// and the XML so the output is readable.
// Usage: bun run scripts/api-examples.ts
import { $getRoot, $isElementNode, type LexicalNode } from 'lexical';
import { mockAwarenessSource } from '../ai-editing/awareness/awareness-source';
import { Doc } from '../ai-editing/doc/doc';
import { createEditingSession, loadMarkdown } from '../ai-editing/ai-toolkit/session';
import { runEditorCode } from '../ai-editing/runtime';
import { serializeWithXml } from '../ai-editing/utils';
import { $getId } from '../plugins/nodeIdPlugin';

type Session = ReturnType<typeof createEditingSession>;
const instant = () => Promise.resolve();

/** Map every real id to a readable b1/t1… and rewrite both the code and the XML
 *  so the docs don't show raw nanoids. `seed` pins the input block ids to b1..bN
 *  (in reference order) so created nodes don't steal the low numbers; everything
 *  else is numbered by first appearance in the XML. */
function normalize(xml: string, code: string, seed: string[]): { xml: string; code: string } {
  const map = new Map<string, string>();
  let b = 0;
  let t = 0;
  for (const id of seed) if (!map.has(id)) map.set(id, `b${++b}`);
  const re = /<(\/?)([\w-]+)\b[^>]*?\bid="([^"]+)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) {
    const [, , tag, id] = m;
    if (!map.has(id)) map.set(id, tag === 't' ? `t${++t}` : `b${++b}`);
  }
  const dedent = (s: string) =>
    s
      .split('\n')
      .map((l) => l.replace(/^[\t ]+/, ''))
      .filter(Boolean)
      .join('\n');
  let outXml = xml;
  let outCode = code;
  for (const [real, friendly] of map) {
    outXml = outXml.split(real).join(friendly);
    outCode = outCode.split(real).join(friendly);
  }
  return { xml: outXml.trim(), code: dedent(outCode) };
}

/** Build a session from markdown, run `editor.<...>` code, print code + XML. */
async function demo(title: string, docNote: string, md: string, makeCode: (ids: string[], s: Session) => string) {
  const s = createEditingSession();
  loadMarkdown(s, md);
  const ids = s.editor.getEditorState().read(() => $getRoot().getChildren().map((c) => $getId(c) ?? '?'));
  const rawCode = makeCode(ids, s);
  const summary = await runEditorCode({
    session: s,
    doc: new Doc(s),
    code: rawCode,
    awarenessSource: mockAwarenessSource(),
    sleep: instant,
  });
  const { xml, code } = normalize(serializeWithXml(s), rawCode, ids);

  console.log(`\n### ${title}\n`);
  console.log('```ts');
  console.log(`// doc: ${docNote}`);
  console.log(code);
  console.log('```');
  console.log('```xml');
  console.log(xml);
  console.log('```');
  if (summary.startsWith('error')) console.log(`!! ${summary}`);
}

/** First descendant text-node id within a block (for the *Node helpers). */
function firstTextId(s: Session, blockId: string): string {
  return s.editor.getEditorState().read(() => {
    const found: string[] = [];
    const walk = (n: LexicalNode) => {
      const id = $getId(n);
      if (n.getType() === 'text' && id) found.push(id);
      if ($isElementNode(n)) for (const c of n.getChildren()) walk(c);
    };
    for (const c of $getRoot().getChildren()) if ($getId(c) === blockId) walk(c);
    return found[0] ?? blockId;
  });
}

await demo(
  'Inline formatting (block id + substring)',
  'the quick brown fox',
  'the quick brown fox',
  ([p]) => `
		editor.bold('${p}', 'quick');
		editor.italic('${p}', 'brown');
		editor.highlight('${p}', 'the');
		editor.link('${p}', 'fox', 'https://x');
	`,
);

await demo(
  'Inline formatting (text-node id directly)',
  'Hello world  (t1 is the text node inside b1)',
  'Hello world',
  ([p], s) => {
    const t = firstTextId(s, p);
    return `
			editor.boldNode('${t}');
			editor.underlineNode('${t}');
		`;
  },
);

await demo(
  'Text content',
  'first / second / third  (three paragraphs)',
  'first\n\nsecond\n\nthird',
  ([a, b, c]) => `
		editor.setText('${a}', 'replaced');
		editor.appendText('${b}', '!!!');
		editor.prependText('${c}', '> ');
		editor.replace('${c}', 'third', 'THIRD');
	`,
);

await demo(
  'Block type',
  'Title / A quote / code here  (three paragraphs)',
  'Title\n\nA quote\n\ncode here',
  ([a, b, c]) => `
		editor.makeHeading('${a}', 2);
		editor.makeQuote('${b}');
		editor.makeCodeBlock('${c}', 'ts');
	`,
);

await demo(
  'Lists',
  'task a / task b  (two paragraphs)',
  'task a\n\ntask b',
  ([a, b]) => `
		editor.checklist(['${a}', '${b}']);
		editor.check('${a}');
		editor.indent('${b}');
	`,
);

await demo(
  'Structure (creators return a handle)',
  'Intro / Body  (two paragraphs)',
  'Intro\n\nBody',
  ([a, b]) => `
		editor.insertHeadingBefore('${a}', 1, 'Title');
		const c = editor.insertParagraphAfter('${b}', 'Conclusion');
		editor.appendText(c, '!');
		editor.appendParagraph('Footer');
	`,
);

await demo(
  'Tables (creators return a handle)',
  'Tasks  (one paragraph)',
  'Tasks',
  () => `
		const t = editor.appendTable([['Item', 'Done']]);
		editor.addRow(t);
		editor.setCell(t, 1, 1, 'yes');
	`,
);

await demo(
  'Media / math / inline objects',
  'Above / Below  (two paragraphs); inserts stack after b1',
  'Above\n\nBelow',
  ([a, b]) => `
		editor.insertDivider('${a}');
		editor.insertImage('${a}', { srcType: 'url', url: 'https://x/cat.png', alt: 'cat' });
		editor.insertInlineEquation('${b}', 0, 'x^2');
	`,
);

await demo(
  'Node specs (appendBlock, …)',
  'Doc  (one paragraph)',
  'Doc',
  () => `
		editor.appendBlock({ block: 'heading', level: 2, text: 'Section' });
		editor.appendBlock({ block: 'list', list: 'check', items: ['todo a', 'todo b'] });
		editor.appendBlock({ block: 'code', language: 'ts', text: 'const x = 1' });
	`,
);
