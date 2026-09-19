import { describe, expect, it } from 'vitest';
import { mockAwarenessSource } from '../awareness/awareness-source';
import { createEditingSession, loadMarkdown } from '../ai-toolkit/session';
import { DocumentEditor } from '../editor/document-editor';
import { type CodeRunner, runEditorCode } from '../runtime';
import { serializeWithXml } from '../utils';
import { Doc } from './doc';

/**
 * Concurrency reproductions at the scale the failure reports describe.
 *
 * An earlier attempt used two writers doing simple inserts and came out clean,
 * which was too weak to justify dismissing the class. The reports describe FOUR
 * OR FIVE concurrent dispatches doing `setText` on existing text nodes, and
 * damage landing on nodes a coder was not targeting:
 *
 *   034f576f  "eric's cell and peter's cell — which Dispatch 2 was NOT targeting"
 *   305047cd  "at least 4 concurrent coder dispatches ... one coder's write to the
 *              heading node collided with a sibling-node write" (heading emptied)
 *   15c0d49a  "one coder's in-progress streamed write interleaved with another"
 *              (bullet permanently truncated)
 *
 * Refs are unique per invocation, as `runInSandbox` guarantees via nanoid — a
 * shared pool produces collisions that have nothing to do with concurrency.
 */
let refSeq = 0;
const runner: CodeRunner = (validIds, code, snippets) => {
  const base = ++refSeq;
  const refs = Array.from({ length: 128 }, (_, i) => `r${base}-${i}`);
  const editor = new DocumentEditor({ validIds, refs });
  new Function('editor', 'snippets', code)(editor, snippets ?? {});
  return editor.drain();
};

function build(md: string) {
  const session = createEditingSession();
  loadMarkdown(session, md);
  const doc = new Doc(session);
  return {
    xml: () => serializeWithXml(session),
    /** Animated path — what prod runs; the Rust caller never sets typingAnimations. */
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

/** Text-run ids in document order. */
const textIds = (xml: string) =>
  [...xml.matchAll(/<t id="([^"]+)"/g)].map((m) => m[1]!);

const textOf = (xml: string) =>
  [...xml.matchAll(/<t[^>]*>([^<]*)<\/t>/g)].map((m) => m[1]!);

describe('concurrent writers at report scale', () => {
  it('five writers each setText a different node, all land, none bleed', async () => {
    const rows = ['alpha', 'bravo', 'charlie', 'delta', 'echo'];
    const b = build(rows.join('\n\n'));
    const ids = textIds(b.xml());
    expect(ids).toHaveLength(5);

    await Promise.all(
      ids.map((id, i) => b.run(`editor.setText('${id}', 'CHANGED-${i}');`))
    );

    const out = textOf(b.xml());
    for (let i = 0; i < 5; i++) expect(out).toContain(`CHANGED-${i}`);
    // Nothing may be left empty or half-written.
    expect(out.filter((t) => t === '')).toHaveLength(0);
    for (const t of out) expect(t).toMatch(/^CHANGED-\d$/);
  });

  it('four writers appending to different nodes do not truncate each other', async () => {
    const b = build(['one', 'two', 'three', 'four'].join('\n\n'));
    const ids = textIds(b.xml());
    await Promise.all(
      ids.map((id, i) => b.run(`editor.appendText('${id}', ' [${i}]');`))
    );
    const out = textOf(b.xml());
    expect(out).toEqual(['one [0]', 'two [1]', 'three [2]', 'four [3]']);
  });

  it('a writer editing one heading does not empty a sibling heading', async () => {
    const b = build('## first heading\n\n## second heading\n\nbody text');
    const ids = textIds(b.xml());
    await Promise.all([
      b.run(`editor.setText('${ids[0]}', 'FIRST rewritten');`),
      b.run(`editor.setText('${ids[1]}', 'SECOND rewritten');`),
      b.run(`editor.appendText('${ids[2]}', ' extended');`),
    ]);
    const out = b.xml();
    expect(out).toContain('FIRST rewritten');
    expect(out).toContain('SECOND rewritten');
    // No emptied heading — the 305047cd signature.
    expect(out).not.toMatch(/<h2 id="[^"]+"\/>/);
  });

  it('writers editing one row do not damage rows they never named', async () => {
    const b = build('julia 0\n\neric 0\n\npeter 0');
    const ids = textIds(b.xml());
    await Promise.all([
      b.run(`editor.setText('${ids[0]}', 'julia -1.1');`),
      b.run(`editor.appendText('${ids[1]}', '');`),
    ]);
    const out = textOf(b.xml());
    expect(out).toContain('julia -1.1');
    // Rows nobody targeted survive verbatim — the 034f576f signature.
    expect(out).toContain('eric 0');
    expect(out).toContain('peter 0');
  });
});
