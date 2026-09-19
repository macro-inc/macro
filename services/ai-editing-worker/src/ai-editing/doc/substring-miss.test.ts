import { describe, expect, it } from 'vitest';
import { createEditingSession, loadMarkdown } from '../ai-toolkit/session';
import { docIds } from '../runtime';
import { serializeWithXml } from '../utils';
import { Doc } from './doc';

function build(md: string) {
  const session = createEditingSession();
  loadMarkdown(session, md);
  return { session, doc: new Doc(session), ids: [...docIds(session)] };
}

/** First block id in the document. */
function blockId(md: string) {
  const b = build(md);
  const id = serializeWithXml(b.session).match(/<p id="([^"]+)"/)?.[1];
  return { ...b, id: id! };
}

describe('substring-targeted ops report a miss', () => {
  it('replace throws when the text is absent, quoting what is there', () => {
    const { doc, id } = blockId('the quick brown fox');
    expect(() =>
      doc.apply({ kind: 'replaceText', node: id, find: 'purple', to: 'green' } as never)
    ).toThrow(/does not occur/);
    expect(() =>
      doc.apply({ kind: 'replaceText', node: id, find: 'purple', to: 'green' } as never)
    ).toThrow(/the quick brown fox/);
  });

  it('replace succeeds and does not throw when the text is present', () => {
    const { doc, session, id } = blockId('the quick brown fox');
    doc.apply({ kind: 'replaceText', node: id, find: 'brown', to: 'red' } as never);
    expect(serializeWithXml(session)).toContain('red');
  });

  it('bold throws when the substring is absent', () => {
    const { doc, id } = blockId('alpha beta');
    expect(() =>
      doc.apply({ kind: 'formatText', node: id, match: 'gamma', format: 'bold', on: true } as never)
    ).toThrow(/does not occur/);
  });

  it('link throws when the substring is absent', () => {
    const { doc, id } = blockId('see the docs');
    expect(() =>
      doc.apply({ kind: 'linkText', node: id, match: 'manual', url: 'https://x.test' } as never)
    ).toThrow(/does not occur/);
  });

  /**
   * The failure that produced the corpus's worst silent thrash (trace 213282e2):
   * the needle IS in the block, but split across text runs, so the per-run
   * matchers can never see it. The coder narrowed from a substring all the way
   * to the node's entire text and got no error at any point.
   */
  it('names the split-run cause when the text spans separate runs', () => {
    const { doc, session, id } = blockId('total 408 done');
    // Bold one word so the paragraph holds three separate text runs.
    doc.apply({ kind: 'formatText', node: id, match: '408', format: 'bold', on: true } as never);
    const runs = serializeWithXml(session).match(/<t /g) ?? [];
    expect(runs.length).toBeGreaterThan(1);

    // "total 408" now straddles run 1 and run 2.
    let message = '';
    try {
      doc.apply({ kind: 'replaceText', node: id, find: 'total 408', to: 'total 414' } as never);
    } catch (e) {
      message = (e as Error).message;
    }
    expect(message).toMatch(/SPLIT ACROSS/);
    // The runs are quoted so the boundary is visible.
    expect(message).toContain('"total "');
    // And it points at the way out.
    expect(message).toMatch(/setText/);
  });

  it('clearFormat with no match string still strips everything without throwing', () => {
    const { doc, id } = blockId('alpha beta');
    doc.apply({ kind: 'formatText', node: id, match: 'alpha', format: 'bold', on: true } as never);
    expect(() =>
      doc.apply({ kind: 'clearFormat', node: id, match: undefined } as never)
    ).not.toThrow();
  });
});
