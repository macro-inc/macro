import { $getRoot } from 'lexical';
import { describe, expect, it } from 'vitest';
import { $getId } from '../../../lexical-core/plugins/nodeIdPlugin';
import { mockAwarenessSource } from './awareness/awareness-source';
import { Doc } from './doc/doc';
import { DocumentEditor } from './editor/document-editor';
import { type CodeRunner, docIds, runEditorCode } from './runtime';

// In-process executor for unit tests: the QuickJS sandbox's wasm import doesn't
// resolve under bun test, so tests run the snippet via `new Function`. Production
// always goes through `runInSandbox`. The id pool mirrors what the host injects.
const newFunctionRunner: CodeRunner = (validIds, code) => {
  const refs = Array.from({ length: 128 }, (_, i) => `ref-${i + 1}`);
  const editor = new DocumentEditor({ validIds, refs });
  // eslint-disable-next-line no-new-func
  new Function('editor', code)(editor);
  return editor.drain();
};

import type { Session } from './ai-toolkit/session';
import { createEditingSession, loadMarkdown } from './ai-toolkit/session';
import { serializeWithXml } from './utils';

function build(md: string): { session: Session; ids: string[] } {
  const session = createEditingSession();
  loadMarkdown(session, md);
  const ids = [...docIds(session)];
  return { session, ids };
}

/** Top-level block ids in document order. */
function topIds(session: Session): string[] {
  return session.editor.getEditorState().read(() =>
    $getRoot()
      .getChildren()
      .map((c) => $getId(c) ?? '?')
  );
}

/** Run a snippet end-to-end (editor → ops → queue → real Doc), no timers/awareness delay. */
async function runCode(session: Session, code: string): Promise<string> {
  return runEditorCode({
    session,
    doc: new Doc(session),
    code,
    runner: newFunctionRunner,
    awarenessSource: mockAwarenessSource(),
    sleep: () => Promise.resolve(),
  });
}

describe('runtime — end to end against real Lexical', () => {
  it('applies a multi-op snippet and returns compact success output', async () => {
    const { session } = build('Notes\n\nthe Bluejay launched');
    const [headingId, paragraphId] = topIds(session);
    const summary = await runCode(
      session,
      `editor.convertToHeading('${headingId}', 2); editor.bold('${paragraphId}', 'Bluejay');`
    );
    expect(summary).toBe('ok');
    const out = serializeWithXml(session);
    expect(out).toContain('<h2');
    expect(out).toContain('Notes');
    expect(out).toContain('Bluejay');
  });

  it('types new content char-by-char into a created block (ref resolves)', async () => {
    const { session, ids } = build('first');
    const summary = await runCode(
      session,
      `const p = editor.insertParagraphAfter('${ids[0]}', 'hello'); editor.bold(p, 'hello');`
    );
    expect(summary).toBe('ok');
    expect(serializeWithXml(session)).toContain('hello');
  });

  it('reports an eager EditError and applies nothing', async () => {
    const { session } = build('untouched');
    const summary = await runCode(
      session,
      `editor.bold('does-not-exist', 'x');`
    );
    expect(summary).toMatch(/error: unknown id/);
    expect(serializeWithXml(session)).toContain('untouched'); // unchanged
  });

  it('continues independent ops when one fails at apply time', async () => {
    const { session } = build('alpha\n\nbeta');
    const [alpha, beta] = topIds(session);
    // first op fails (setCell on a non-table block); the heading op still applies.
    const summary = await runCode(
      session,
      `editor.setCell('${alpha}', 9, 9, 'x'); editor.convertToHeading('${beta}', 3);`
    );
    expect(summary).toMatch(
      /error: setCell: id ".+" is a <paragraph>, not a table/
    );
    expect(serializeWithXml(session)).toContain('<h3');
    expect(serializeWithXml(session)).toContain('beta');
  });
});

describe('runtime — awareness ref resolution', () => {
  it('points cursors at the inserted node, whose ref is its durable id', async () => {
    const { session, ids } = build('first');
    const awareness = mockAwarenessSource();
    await runEditorCode({
      session,
      doc: new Doc(session),
      code: `editor.insertParagraphAfter('${ids[0]}', 'hi');`,
      runner: newFunctionRunner,
      awarenessSource: awareness,
      sleep: () => Promise.resolve(),
    });
    expect(awareness.seen.length).toBeGreaterThan(0);
    // refs ARE ids: every awareness node id resolves to a real node in the doc.
    const real = docIds(session);
    expect(awareness.seen.every((x) => real.has(x.node))).toBe(true);
  });
});

