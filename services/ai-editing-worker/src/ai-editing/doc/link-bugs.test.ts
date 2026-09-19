import { describe, expect, it } from 'vitest';
import { createEditingSession, loadMarkdown } from '../ai-toolkit/session';
import { serializeWithXml } from '../utils';
import { Doc } from './doc';

/**
 * Reproductions for the `link` defects the failure reports name. Each `it` is a
 * claim from a specific trace; the point is to find out which are real before
 * changing anything.
 */
function build(md: string) {
  const session = createEditingSession();
  loadMarkdown(session, md);
  const doc = new Doc(session);
  const xml = () => serializeWithXml(session);
  const id = xml().match(/<p id="([^"]+)"/)?.[1]!;
  return { session, doc, xml, id };
}

const link = (node: string, match: string, url: string | null) =>
  ({ kind: 'linkText', node, match, url }) as never;

describe('link defects from the failure corpus', () => {
  // trace 90f5450c: "the hyperlink swallowed the entire remaining text of the
  // bullet instead of only '#4863'". Shared engine with bold/inlineCode, so if
  // real this is much wider than link.
  it('wraps only the matched substring, not the rest of the block', () => {
    const { doc, xml, id } = build('see #4863 after being merged');
    doc.apply(link(id, '#4863', 'https://x.test/4863'));
    const anchor = xml().match(/<a[^>]*>[\s\S]*?<\/a>/)?.[0] ?? '';
    expect(anchor).toContain('#4863');
    expect(anchor).not.toContain('after being merged');
  });

  it('wraps only the matched substring when the match is at the start', () => {
    const { doc, xml, id } = build('#4863 trailing words here');
    doc.apply(link(id, '#4863', 'https://x.test/4863'));
    const anchor = xml().match(/<a[^>]*>[\s\S]*?<\/a>/)?.[0] ?? '';
    expect(anchor).not.toContain('trailing words here');
  });

  // trace 07218654: "editor.link inserted a second, nested <a> inside the
  // original one ... with the placeholder URL still present".
  it('does not nest a second anchor inside an existing one', () => {
    const { doc, xml, id } = build('go to [docs](https://old.test) now');
    doc.apply(link(id, 'docs', 'https://new.test'));
    const out = xml();
    // No <a> directly containing another <a>.
    expect(out).not.toMatch(/<a[^>]*>[\s\S]*?<a[^>]*>/);
  });

  it('retargets an existing link rather than leaving the old href', () => {
    const { doc, xml, id } = build('go to [docs](https://old.test) now');
    doc.apply(link(id, 'docs', 'https://new.test'));
    const out = xml();
    expect(out).toContain('https://new.test');
    expect(out).not.toContain('https://old.test');
  });
});
