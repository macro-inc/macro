import { describe, expect, it } from 'vitest';
import { $getRoot } from 'lexical';
import { $getId } from '../plugins/nodeIdPlugin';
import { mockAwarenessSource } from './awareness/awareness-source';
import { Doc } from './doc/doc';
import { docIds, runEditorCode } from './runtime';
import { createEditingSession, loadMarkdown } from './ai-toolkit/session';
import { serializeWithIds } from './utils';
import type { Session } from './ai-toolkit/session';

function plain(s: Session): string {
  return serializeWithIds(s).split('\n').map((l) => l.replace(/^\d+ \| /, '')).join('\n');
}

function build(md: string): { s: Session; ids: string[] } {
  const s = createEditingSession();
  loadMarkdown(s, md);
  const ids = [...docIds(s)];
  return { s, ids };
}

/** Top-level block ids in document order. */
function topIds(s: Session): string[] {
  return s.editor.getEditorState().read(() => $getRoot().getChildren().map((c) => $getId(c) ?? '?'));
}

/** Run a snippet end-to-end (editor → ops → queue → real Doc), no timers/awareness delay. */
async function runCode(s: Session, code: string): Promise<string> {
  return runEditorCode({
    session: s,
    doc: new Doc(s),
    code,
    awarenessSource: mockAwarenessSource(),
    sleep: () => Promise.resolve(),
  });
}

describe('runtime — end to end against real Lexical', () => {
  it('applies a multi-op snippet and returns a per-op summary (not a diff)', async () => {
    const { s } = build('Notes\n\nthe Bluejay launched');
    const [h, p] = topIds(s);
    const summary = await runCode(s, `editor.makeHeading('${h}', 2); editor.bold('${p}', 'Bluejay');`);
    expect(summary).toContain(`{${h}} → heading h2`);
    expect(summary).toContain(`bold "Bluejay" in {${p}}`);
    const out = plain(s);
    expect(out).toContain('## Notes');
    expect(out).toContain('**Bluejay**');
  });

  it('types new content char-by-char into a created block (ref resolves)', async () => {
    const { s, ids } = build('first');
    const summary = await runCode(s, `const p = editor.insertParagraphAfter('${ids[0]}', 'hello'); editor.bold(p, 'hello');`);
    expect(summary).toContain('inserted paragraph');
    expect(plain(s)).toContain('**hello**');
  });

  it('reports an eager EditError and applies nothing', async () => {
    const { s, ids } = build('untouched');
    const summary = await runCode(s, `editor.bold('does-not-exist', 'x');`);
    expect(summary).toMatch(/error: unknown id/);
    expect(plain(s)).toBe(`untouched {${ids[0]}|paragraph}`); // unchanged
  });

  it('reports "no operations" for an empty snippet', async () => {
    const { s } = build('hi');
    expect(await runCode(s, '/* nothing */')).toBe('no operations');
  });

  it('continues independent ops when one fails at apply time', async () => {
    const { s } = build('alpha\n\nbeta');
    const [alpha, beta] = topIds(s);
    // first op fails (setCell on a non-table block); the heading op still applies.
    const summary = await runCode(s, `editor.setCell('${alpha}', 9, 9, 'x'); editor.makeHeading('${beta}', 3);`);
    expect(summary).toMatch(/✗/); // the bad cell op failed
    expect(summary).toContain('→ heading h3'); // the good op applied
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
