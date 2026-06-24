import { describe, expect, it } from 'vitest';
import { $getRoot } from 'lexical';
import { $getId } from '../../../lexical-core/plugins/nodeIdPlugin';
import { mockAwarenessSource } from './awareness/awareness-source';
import { Doc } from './doc/doc';
import { docIds, runEditorCode, type CodeRunner } from './runtime';
import { DocumentEditor } from './editor/document-editor';

const newFunctionRunner: CodeRunner = (validIds, code) => {
  const editor = new DocumentEditor({ validIds });
  // eslint-disable-next-line no-new-func
  new Function('editor', code)(editor);
  return editor.drain();
};
import { createEditingSession, loadMarkdown } from './ai-toolkit/session';
import { serializeWithIds } from './utils';
import type { Session } from './ai-toolkit/session';

function plain(s: Session): string {
  return serializeWithIds(s)
    .split('\n')
    .map((l) => l.replace(/^\d+ \| /, ''))
    .join('\n');
}

function build(md: string): { s: Session; ids: string[] } {
  const s = createEditingSession();
  loadMarkdown(s, md);
  const ids = [...docIds(s)];
  return { s, ids };
}

/** Top-level block ids in document order. */
function topIds(s: Session): string[] {
  return s.editor.getEditorState().read(() =>
    $getRoot()
      .getChildren()
      .map((c) => $getId(c) ?? '?')
  );
}

/** Run a snippet end-to-end (editor → ops → queue → real Doc), no timers/awareness delay. */
async function runCode(s: Session, code: string): Promise<string> {
  return runEditorCode({
    session: s,
    doc: new Doc(s),
    code,
    runner: newFunctionRunner,
    awarenessSource: mockAwarenessSource(),
    sleep: () => Promise.resolve(),
  });
}

describe('runtime — end to end against real Lexical', () => {
  it('applies a multi-op snippet and returns compact success output', async () => {
    const { s } = build('Notes\n\nthe Bluejay launched');
    const [h, p] = topIds(s);
    const summary = await runCode(
      s,
      `editor.convertToHeading('${h}', 2); editor.bold('${p}', 'Bluejay');`
    );
    expect(summary).toBe('ok');
    const out = plain(s);
    expect(out).toContain('## Notes');
    expect(out).toContain('**Bluejay**');
  });

  it('types new content char-by-char into a created block (ref resolves)', async () => {
    const { s, ids } = build('first');
    const summary = await runCode(
      s,
      `const p = editor.insertParagraphAfter('${ids[0]}', 'hello'); editor.bold(p, 'hello');`
    );
    expect(summary).toBe('ok');
    expect(plain(s)).toContain('**hello**');
  });

  it('reports an eager EditError and applies nothing', async () => {
    const { s, ids } = build('untouched');
    const summary = await runCode(s, `editor.bold('does-not-exist', 'x');`);
    expect(summary).toMatch(/error: unknown id/);
    expect(plain(s)).toBe(`untouched {${ids[0]}|paragraph}`); // unchanged
  });

  it('reports compact success for an empty snippet', async () => {
    const { s } = build('hi');
    expect(await runCode(s, '/* nothing */')).toBe('ok');
  });

  it('continues independent ops when one fails at apply time', async () => {
    const { s } = build('alpha\n\nbeta');
    const [alpha, beta] = topIds(s);
    // first op fails (setCell on a non-table block); the heading op still applies.
    const summary = await runCode(
      s,
      `editor.setCell('${alpha}', 9, 9, 'x'); editor.convertToHeading('${beta}', 3);`
    );
    expect(summary).toBe('error: setCell: no enclosing table');
    expect(plain(s)).toContain('### beta');
  });
});

describe('runtime — awareness ref resolution', () => {
  it('points cursors at the real inserted node id, never the placeholder ref', async () => {
    const { s, ids } = build('first');
    const awareness = mockAwarenessSource();
    await runEditorCode({
      session: s,
      doc: new Doc(s),
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
    const { s } = build('- one\n- two');
    const ids = docIds(s);
    expect(ids.size).toBeGreaterThanOrEqual(3); // list + 2 items
  });
});
