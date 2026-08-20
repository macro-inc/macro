import { describe, expect, it } from 'vitest';
import { mockAwarenessSource } from '../awareness/awareness-source';
import { createEditingSession, loadMarkdown } from '../ai-toolkit/session';
import { DocumentEditor } from '../editor/document-editor';
import { type CodeRunner, runEditorCode } from '../runtime';
import { serializeWithXml } from '../utils';
import { Doc } from './doc';

/**
 * `setText` must act on the node it is handed.
 *
 * Widening an inline run id to its enclosing block was the largest remaining
 * source of coder retries: `$setText` keeps only the block's first text child, so
 * a coder rewriting several runs in one paragraph destroyed its own remaining
 * targets with the first call. Observed in trace 050417a1 as a run of
 * `No node with id "…"` errors immediately after one successful call.
 */
let refSeq = 0;
const runner: CodeRunner = (validIds, code, snippets) => {
  const base = ++refSeq;
  const editor = new DocumentEditor({
    validIds,
    refs: Array.from({ length: 128 }, (_, i) => `r${base}-${i}`),
  });
  new Function('editor', 'snippets', code)(editor, snippets ?? {});
  return editor.drain();
};

function build(md: string) {
  const session = createEditingSession();
  loadMarkdown(session, md);
  const doc = new Doc(session);
  return {
    xml: () => serializeWithXml(session),
    run: (code: string) =>
      runEditorCode({
        session,
        doc,
        code,
        runner,
        awarenessSource: mockAwarenessSource(),
        sleep: () => Promise.resolve(),
      }),
  };
}

const textIds = (xml: string) =>
  [...xml.matchAll(/<t id="([^"]+)"/g)].map((m) => m[1]!);
const textOf = (xml: string) =>
  [...xml.matchAll(/<t[^>]*>([^<]*)<\/t>/g)].map((m) => m[1]!);
const blockId = (xml: string) => xml.match(/<p id="([^"]+)"/)![1]!;

describe('setText scope', () => {
  it('rewrites several runs in one paragraph without losing any', async () => {
    // "plain **bold** more" gives three sibling runs in one paragraph.
    const b = build('plain **bold** more');
    const ids = textIds(b.xml());
    expect(ids).toHaveLength(3);

    const result = await b.run(
      ids.map((id, i) => `editor.setText('${id}', 'RUN${i}');`).join('\n')
    );

    expect(result).not.toMatch(/No node with id/);
    expect(textOf(b.xml())).toEqual(['RUN0', 'RUN1', 'RUN2']);
  });

  it('leaves sibling runs untouched when setting one run', async () => {
    const b = build('keep **target** keep2');
    const ids = textIds(b.xml());
    await b.run(`editor.setText('${ids[1]}', 'REPLACED');`);
    expect(textOf(b.xml())).toEqual(['keep ', 'REPLACED', ' keep2']);
  });

  it('preserves the formatting of the run it sets', async () => {
    const b = build('plain **bold** more');
    const ids = textIds(b.xml());
    await b.run(`editor.setText('${ids[1]}', 'STILL BOLD');`);
    const xml = b.xml();
    expect(xml).toMatch(/<t[^>]*bold="true"[^>]*>STILL BOLD<\/t>/);
  });

  it('still replaces the whole block when given a block id', async () => {
    const b = build('plain **bold** more');
    const id = blockId(b.xml());
    await b.run(`editor.setText('${id}', 'flattened');`);
    expect(textOf(b.xml())).toEqual(['flattened']);
  });

  it('removes a run when set to empty text', async () => {
    const b = build('keep **drop** keep2');
    const ids = textIds(b.xml());
    await b.run(`editor.setText('${ids[1]}', '');`);
    expect(textOf(b.xml())).toEqual(['keep ', ' keep2']);
  });

  it('reproduces the 050417a1 pattern: rewrite runs then format one', async () => {
    const b = build('Calling for **him**');
    const ids = textIds(b.xml());
    const result = await b.run(
      `editor.setText('${ids[0]}', 'Reaching for ');\n` +
        `editor.setText('${ids[1]}', 'him');\n` +
        `editor.italic('${ids[1]}', 'him');`
    );
    expect(result).not.toMatch(/No node with id/);
    expect(b.xml()).toContain('Reaching for ');
    expect(b.xml()).toMatch(/italic="true"/);
  });
});
