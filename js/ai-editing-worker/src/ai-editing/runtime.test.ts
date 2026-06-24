import { $getRoot } from 'lexical';
import { describe, expect, it } from 'vitest';
import { $getId } from '../../../lexical-core/plugins/nodeIdPlugin';
import { mockAwarenessSource } from './awareness/awareness-source';
import { Doc } from './doc/doc';
import { DocumentEditor } from './editor/document-editor';
import { type CodeRunner, docIds, runEditorCode } from './runtime';

const newFunctionRunner: CodeRunner = (validIds, code) => {
  const editor = new DocumentEditor({ validIds });
  // eslint-disable-next-line no-new-func
  new Function('editor', code)(editor);
  return editor.drain();
};

import type { Session } from './ai-toolkit/session';
import { createEditingSession, loadMarkdown } from './ai-toolkit/session';
import { serializeWithXml } from './utils';

function plain(session: Session): string {
  return serializeWithXml(session);
}

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
    const out = plain(session);
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
    expect(plain(session)).toContain('hello');
  });

  it('reports an eager EditError and applies nothing', async () => {
    const { session } = build('untouched');
    const summary = await runCode(
      session,
      `editor.bold('does-not-exist', 'x');`
    );
    expect(summary).toMatch(/error: unknown id/);
    expect(plain(session)).toContain('untouched'); // unchanged
  });

  it('reports compact success for an empty snippet', async () => {
    const { session } = build('hi');
    expect(await runCode(session, '/* nothing */')).toBe('ok');
  });

  it('continues independent ops when one fails at apply time', async () => {
    const { session } = build('alpha\n\nbeta');
    const [alpha, beta] = topIds(session);
    // first op fails (setCell on a non-table block); the heading op still applies.
    const summary = await runCode(
      session,
      `editor.setCell('${alpha}', 9, 9, 'x'); editor.convertToHeading('${beta}', 3);`
    );
    expect(summary).toBe('error: setCell: no enclosing table');
    expect(plain(session)).toContain('<h3');
    expect(plain(session)).toContain('beta');
  });
});

describe('runtime — awareness ref resolution', () => {
  it('points cursors at the real inserted node id, never the placeholder ref', async () => {
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
    // every awareness node was resolved through Doc.resolveRef → a real id.
    expect(awareness.seen.every((x) => !x.node.startsWith('ref-'))).toBe(true);
  });
});

describe('docIds', () => {
  it('collects every durable id including nested list items', () => {
    const { session } = build('- one\n- two');
    const ids = docIds(session);
    expect(ids.size).toBeGreaterThanOrEqual(3); // list + 2 items
  });
});
