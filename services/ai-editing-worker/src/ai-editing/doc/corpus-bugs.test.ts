import { describe, expect, it } from 'vitest';
import { mockAwarenessSource } from '../awareness/awareness-source';
import { createEditingSession, loadMarkdown } from '../ai-toolkit/session';
import { DocumentEditor } from '../editor/document-editor';
import { type CodeRunner, docIds, runEditorCode } from '../runtime';
import { serializeWithXml } from '../utils';
import { Doc } from './doc';

/**
 * One `it` per claim taken from the hand-written failure reports, so a claim can
 * be confirmed or dismissed before anything is changed for it.
 */
/** Refs must be globally unique per invocation, as `runInSandbox` guarantees via
 *  nanoid — a shared pool would make two concurrent writers mint the same ref and
 *  collide for reasons that have nothing to do with the code under test. */
let refSeq = 0;
const runner: CodeRunner = (validIds, code, snippets) => {
  const base = ++refSeq;
  const refs = Array.from({ length: 128 }, (_, i) => `ref-${base}-${i + 1}`);
  const editor = new DocumentEditor({ validIds, refs });
  new Function('editor', 'snippets', code)(editor, snippets ?? {});
  return editor.drain();
};

function build(md: string) {
  const session = createEditingSession();
  loadMarkdown(session, md);
  const doc = new Doc(session);
  return {
    session,
    doc,
    xml: () => serializeWithXml(session),
    ids: () => [...docIds(session)],
    /** Animated path — what prod runs, since the caller never sets
     *  typingAnimations. */
    run: (code: string, snippets?: Record<string, string>) =>
      runEditorCode({
        session,
        doc,
        code,
        runner,
        awarenessSource: mockAwarenessSource(),
        sleep: () => Promise.resolve(),
        snippets,
      }),
    /** Direct-apply path, used when animations are disabled. */
    runInstant: (code: string) =>
      runEditorCode({
        session,
        doc,
        code,
        runner,
        awarenessSource: mockAwarenessSource(),
        sleep: () => Promise.resolve(),
        typingAnimations: false,
      }),
  };
}

const blockIds = (xml: string) =>
  [...xml.matchAll(/<(?:p|h[1-6]|li) id="([^"]+)"/g)].map((m) => m[1]!);

describe('claims from the failure corpus', () => {
  // 20fbd0f4: "A concurrent dispatch's insertParagraphAfter for the new
  // paragraph was lost in the last-write-wins merge."
  // Verified NOT a product bug: the interleaving originally seen here came from
  // a shared ref pool in this test file, not from the animation queue. With
  // unique refs — which `runInSandbox` guarantees via nanoid — concurrent
  // animated writers do not interleave. Kept as a guard.
  it('keeps both inserts when two writers append after the same node (animated)', async () => {
    const b = build('anchor paragraph');
    const anchor = blockIds(b.xml())[0]!;
    await Promise.all([
      b.run(`editor.insertParagraphAfter('${anchor}', 'from writer A');`),
      b.run(`editor.insertParagraphAfter('${anchor}', 'from writer B');`),
    ]);
    const out = b.xml();
    expect(out).toContain('from writer A');
    expect(out).toContain('from writer B');
    // No interleaving: neither insert may appear spliced into the other.
    expect(out).not.toMatch(/from writer B[^<]*A/);
  });

  it('keeps both inserts with animations disabled too', async () => {
    const b = build('anchor paragraph');
    const anchor = blockIds(b.xml())[0]!;
    await Promise.all([
      b.runInstant(`editor.insertParagraphAfter('${anchor}', 'from writer A');`),
      b.runInstant(`editor.insertParagraphAfter('${anchor}', 'from writer B');`),
    ]);
    expect(b.xml()).toContain('from writer A');
    expect(b.xml()).toContain('from writer B');
  });

  it('does not interleave two writers typing into the same paragraph', async () => {
    const b = build('seed');
    const id = blockIds(b.xml())[0]!;
    await Promise.all([
      b.run(`editor.appendText('${id}', 'AAAAAAAA');`),
      b.run(`editor.appendText('${id}', 'BBBBBBBB');`),
    ]);
    const text = b.xml().match(/<t[^>]*>([^<]*)<\/t>/)?.[1] ?? '';
    // Each run must appear as one contiguous block, in some order.
    expect(text).toMatch(/^seed(AAAAAAAABBBBBBBB|BBBBBBBBAAAAAAAA)$/);
  });

  // 20fbd0f4: "one coder's setText/replace on node X was lost" — two writers
  // editing DIFFERENT sibling nodes concurrently.
  it('keeps both edits when two writers change different sibling blocks', async () => {
    const b = build('first block\n\nsecond block');
    const [one, two] = blockIds(b.xml());
    await Promise.all([
      b.run(`editor.setText('${one}', 'ONE changed');`),
      b.run(`editor.setText('${two}', 'TWO changed');`),
    ]);
    const out = b.xml();
    expect(out).toContain('ONE changed');
    expect(out).toContain('TWO changed');
  });

  // 02d942d1: "the coder repeatedly could not reliably un-nest a <li><ul><li>
  // structure in place; it took a full delete+recreate."
  it('can flatten a nested list item with outdent', async () => {
    const b = build('- outer\n    - nested item\n');
    const nested = [...b.xml().matchAll(/<li id="([^"]+)"/g)].map((m) => m[1]!);
    const inner = nested[nested.length - 1]!;
    const result = await b.run(`editor.outdent('${inner}');`);
    expect(result).not.toMatch(/^error/);
    expect(result).toContain('CHANGED');
  });

  // 1259cd5a: "written to the document containing literal backslash-quote
  // characters (e.g. \\"Stop,\\")" — does snippet text leak escapes?
  it('does not leak backslashes from snippet text', async () => {
    const b = build('placeholder');
    const id = blockIds(b.xml())[0]!;
    await b.run(`editor.setText('${id}', snippets.line);`, {
      line: 'She said "Stop," and left.',
    });
    const out = b.xml();
    expect(out).toContain('&quot;Stop,&quot;');
    expect(out).not.toContain('\\');
  });

  // 02d942d1: "coder called editor.remove with an ID that never appeared in the
  // trace" — must be rejected, not silently applied elsewhere.
  it('rejects a fabricated node id with a clear error', async () => {
    const b = build('untouched content');
    const before = b.xml();
    const result = await b.run(`editor.remove('lXTpAA3g');`);
    expect(result).toMatch(/error/);
    expect(result).toMatch(/lXTpAA3g/);
    expect(b.xml()).toBe(before);
  });

  // d8f37ff1: "editor.link only accepts href and text, so rel/target were
  // silently omitted" — a capability gap, recorded so it is not forgotten.
  it('has no surface for rel/target on a link', async () => {
    const b = build('see docs here');
    const id = blockIds(b.xml())[0]!;
    await b.run(`editor.link('${id}', 'docs', 'https://x.test');`);
    const out = b.xml();
    expect(out).toContain('href="https://x.test"');
    // Documents current behaviour: no way to ask for these.
    expect(out).not.toContain('rel=');
    expect(out).not.toContain('target=');
  });
});
