import { $isLinkNode } from '@lexical/link';
import { $isMarkNode } from '@lexical/mark';
import {
  $createTextNode,
  $getRoot,
  $isTextNode,
  type ElementNode,
} from 'lexical';
import { describe, expect, it } from 'vitest';
import { $getId } from '../../../../lexical-core/plugins/nodeIdPlugin';
import { serializeWithXml } from '../utils';
import { edit, read, setup } from './_test-helpers';
import {
  $appendText,
  $clearFormat,
  $formatTextInBlock,
  $highlightInBlock,
  $prependText,
  $replaceString,
  $replaceTextInBlock,
  $wrapInLink,
} from './inline';
import { $blockById } from './locate';
import { collectTextNodes } from './tree';

// ============================================================================
describe('inline ops: scope + counts', () => {
  it('$replaceTextInBlock — frog -> bold toad, all:true returns 2', () => {
    const { session, ids } = setup('the frog ate the frog');
    const id = ids[0];
    const count = edit(session, () =>
      $replaceTextInBlock(
        $blockById(session, id),
        'frog',
        () => $createTextNode('toad').toggleFormat('bold'),
        { kind: 'all' }
      )
    );
    expect(count).toBe(2);
    const xml = serializeWithXml(session);
    expect(xml).toContain('toad');
    expect(xml).not.toContain('frog');
    expect(xml).toContain(`id="${id}"`);
  });

  it('$replaceTextInBlock — default targets only the first match (count 1)', () => {
    const { session, ids } = setup('the frog ate the frog');
    const id = ids[0];
    const count = edit(session, () =>
      $replaceTextInBlock($blockById(session, id), 'frog', () =>
        $createTextNode('toad')
      )
    );
    expect(count).toBe(1);
    const xml = serializeWithXml(session);
    // first frog replaced, second remains
    const firstToad = xml.indexOf('toad');
    const remainingFrog = xml.indexOf('frog');
    expect(firstToad).toBeGreaterThanOrEqual(0);
    expect(remainingFrog).toBeGreaterThan(firstToad);
  });

  it('$replaceTextInBlock — { nth } is 1-based', () => {
    const { session, ids } = setup('the frog ate the frog');
    const id = ids[0];
    const count = edit(session, () =>
      $replaceTextInBlock(
        $blockById(session, id),
        'frog',
        () => $createTextNode('toad'),
        { kind: 'nth', n: 2 }
      )
    );
    expect(count).toBe(1);
    const xml = serializeWithXml(session);
    // first frog remains, second replaced
    const firstFrog = xml.indexOf('frog');
    const toad = xml.indexOf('toad');
    expect(firstFrog).toBeGreaterThanOrEqual(0);
    expect(toad).toBeGreaterThan(firstFrog);
  });

  it('$formatTextInBlock — bold a substring (count), no-match returns 0', () => {
    const { session, ids } = setup('the Bluejay launch');
    const id = ids[0];
    const count = edit(session, () =>
      $formatTextInBlock($blockById(session, id), 'Bluejay', 'bold', {
        kind: 'all',
      })
    );
    expect(count).toBe(1);
    const xml = serializeWithXml(session);
    expect(xml).toContain('Bluejay');
    expect(xml).toContain(`id="${id}"`);

    const miss = edit(session, () =>
      $formatTextInBlock($blockById(session, id), 'Robin', 'bold')
    );
    expect(miss).toBe(0);
  });

  it('$formatTextInBlock — strike maps to strikethrough', () => {
    const { session, ids } = setup('hello world');
    const id = ids[0];
    edit(session, () =>
      $formatTextInBlock($blockById(session, id), 'world', 'strike')
    );
    const xml = serializeWithXml(session);
    expect(xml).toContain('world');
    expect(xml).toContain(`id="${id}"`);
    // the text node with 'world' should have strikethrough format
    const worldNode = read(session, () => {
      const block = $getRoot().getFirstChild() as ElementNode;
      for (const c of block.getChildren()) {
        if ($isTextNode(c) && c.getTextContent() === 'world') return c;
      }
      return null;
    });
    expect(worldNode).not.toBeNull();
    expect(read(session, () => worldNode!.hasFormat('strikethrough'))).toBe(
      true
    );
  });

  it('$clearFormat — removes one format, leaving others', () => {
    // "Bluejay" is bold+italic; clearing bold should leave italic
    const { session, ids } = setup('the ***Bluejay*** launch');
    const id = ids[0];
    const count = edit(session, () =>
      $clearFormat($blockById(session, id), 'Bluejay', 'bold', { kind: 'all' })
    );
    expect(count).toBe(1);
    const bluejayNode = read(session, () => {
      const block = $getRoot().getFirstChild() as ElementNode;
      for (const c of block.getChildren()) {
        if ($isTextNode(c) && c.getTextContent() === 'Bluejay') return c;
      }
      return null;
    });
    expect(bluejayNode).not.toBeNull();
    expect(read(session, () => bluejayNode!.hasFormat('bold'))).toBe(false);
    expect(read(session, () => bluejayNode!.hasFormat('italic'))).toBe(true);
  });

  it('$clearFormat — without format clears all formatting', () => {
    const { session, ids } = setup('the ***Bluejay*** launch');
    const id = ids[0];
    edit(session, () => $clearFormat($blockById(session, id), 'Bluejay'));
    const xml = serializeWithXml(session);
    expect(xml).toContain('Bluejay');
    expect(xml).toContain(`id="${id}"`);
    const bluejayNode = read(session, () => {
      const block = $getRoot().getFirstChild() as ElementNode;
      for (const c of block.getChildren()) {
        if ($isTextNode(c) && c.getTextContent() === 'Bluejay') return c;
      }
      return null;
    });
    expect(bluejayNode).not.toBeNull();
    expect(read(session, () => bluejayNode!.hasFormat('bold'))).toBe(false);
    expect(read(session, () => bluejayNode!.hasFormat('italic'))).toBe(false);
  });

  it('$replaceString — literal replace, counts, default vs all', () => {
    const { session, ids } = setup('Q3 roadmap and Q3 budget');
    const id = ids[0];
    const count = edit(session, () =>
      $replaceString($blockById(session, id), 'Q3', 'Q4', { kind: 'all' })
    );
    expect(count).toBe(2);
    const xml = serializeWithXml(session);
    expect(xml).toContain('Q4');
    expect(xml).not.toContain('Q3');

    const miss = edit(session, () =>
      $replaceString($blockById(session, id), 'Q9', 'Q1')
    );
    expect(miss).toBe(0);
  });

  it('$replaceString mutates in place — text node ids survive (no churn)', () => {
    const { session, ids } = setup('Full control over rendering');
    const id = ids[0];
    const before = read(session, () =>
      collectTextNodes($blockById(session, id)).map((n) => $getId(n))
    );
    edit(session, () => $replaceString($blockById(session, id), 'Full ', ''));
    const after = read(session, () =>
      collectTextNodes($blockById(session, id)).map((n) => $getId(n))
    );
    expect(after).toEqual(before); // same leaf ids — the diff sees a clean setText
    expect(read(session, () => $blockById(session, id).getTextContent())).toBe(
      'control over rendering'
    );
  });

  it('$appendText / $prependText extend an existing plain text node in place', () => {
    const { session, ids } = setup('Meeting Notes');
    const id = ids[0];
    const before = read(session, () =>
      collectTextNodes($blockById(session, id)).map((n) => $getId(n))
    );
    edit(session, () => $appendText($blockById(session, id), ' (draft)'));
    edit(session, () => $prependText($blockById(session, id), 'DRAFT: '));
    const after = read(session, () =>
      collectTextNodes($blockById(session, id)).map((n) => $getId(n))
    );
    expect(after).toEqual(before); // no new text nodes minted
    expect(read(session, () => $blockById(session, id).getTextContent())).toBe(
      'DRAFT: Meeting Notes (draft)'
    );
  });

  it('formatting a substring preserves surrounding formats, scopes the span', () => {
    // whole "two three four" span is bold; italicize only "three"
    const { session, ids } = setup('one **two three four** five');
    const id = ids[0];
    edit(session, () =>
      $formatTextInBlock($blockById(session, id), 'three', 'italic')
    );
    const segs = read(session, () => {
      const block = $getRoot().getFirstChild() as ElementNode;
      const out: Array<{ text: string; bold: boolean; italic: boolean }> = [];
      for (const c of block.getChildren()) {
        if ($isTextNode(c)) {
          out.push({
            text: c.getTextContent(),
            bold: c.hasFormat('bold'),
            italic: c.hasFormat('italic'),
          });
        }
      }
      return out;
    });
    const three = segs.find((x) => x.text === 'three');
    expect(three).toBeDefined();
    expect(three!.bold).toBe(true); // surrounding bold preserved
    expect(three!.italic).toBe(true); // target span got italic
    // everything else keeps bold==their original and italic==false
    for (const seg of segs) {
      if (seg.text !== 'three') expect(seg.italic).toBe(false);
    }
    // the bold-but-not-three pieces are still bold
    expect(segs.find((x) => x.text.includes('two'))!.bold).toBe(true);
    expect(segs.find((x) => x.text.includes('four'))!.bold).toBe(true);
  });

  it('edge matches: needle at very start and very end both work', () => {
    const { session, ids } = setup('frog middle frog');
    const id = ids[0];
    const count = edit(session, () =>
      $formatTextInBlock($blockById(session, id), 'frog', 'bold', {
        kind: 'all',
      })
    );
    expect(count).toBe(2);
    const xml = serializeWithXml(session);
    expect(xml).toContain('frog');
    expect(xml).toContain(`id="${id}"`);
    // both frog occurrences are bold
    const boldFrogs = read(session, () => {
      const block = $getRoot().getFirstChild() as ElementNode;
      return block
        .getChildren()
        .filter(
          (c) =>
            $isTextNode(c) &&
            c.getTextContent() === 'frog' &&
            c.hasFormat('bold')
        );
    });
    expect(boldFrogs).toHaveLength(2);
  });

  it('scoped first-match does not bleed when needle repeats in the same text node', () => {
    // "XX" is one TextNode; formatting "X" with default scope (first only) must
    // not touch the second X even though both pieces equal the needle after splitting.
    const { session, ids } = setup('XX');
    const id = ids[0];
    const count = edit(session, () =>
      $formatTextInBlock($blockById(session, id), 'X', 'bold')
    );
    expect(count).toBe(1);
    const segs = read(session, () => {
      const block = $getRoot().getFirstChild() as ElementNode;
      const result: Array<{ text: string; bold: boolean }> = [];
      for (const c of block.getChildren()) {
        if ($isTextNode(c))
          result.push({ text: c.getTextContent(), bold: c.hasFormat('bold') });
      }
      return result;
    });
    // exactly one bold X and one non-bold X
    expect(segs.filter((x) => x.bold).map((x) => x.text)).toEqual(['X']);
    expect(segs.filter((x) => !x.bold).map((x) => x.text)).toEqual(['X']);
  });

  it('$appendText / $prependText add text at the ends', () => {
    const { session, ids } = setup('# Meeting Notes');
    const id = ids[0];
    edit(session, () => $appendText($blockById(session, id), ' (draft)'));
    let xml = serializeWithXml(session);
    expect(xml).toContain('Meeting Notes (draft)');
    expect(xml).toContain(`id="${id}"`);
    edit(session, () => $prependText($blockById(session, id), 'DRAFT: '));
    xml = serializeWithXml(session);
    expect(xml).toContain('DRAFT: Meeting Notes (draft)');
    expect(xml).toContain(`id="${id}"`);
  });
});

// ============================================================================
// Links and marks do NOT round-trip through serializeWithXml, so inspect the
// node tree with $isLinkNode / $isMarkNode.
describe('deferred: links / highlight (node-tree assertions)', () => {
  it('$wrapInLink wraps a substring in a LinkNode; count returned', () => {
    const { session, ids } = setup('see the docs');
    const id = ids[0];
    const count = edit(session, () =>
      $wrapInLink(
        $blockById(session, id),
        'the docs',
        'https://docs.example.com'
      )
    );
    expect(count).toBe(1);
    const { hasLink, url, linkText, leading } = read(session, () => {
      const block = $getRoot().getFirstChild() as ElementNode;
      let hasLink = false;
      let url = '';
      let linkText = '';
      let leading = '';
      for (const c of block.getChildren()) {
        if ($isLinkNode(c)) {
          hasLink = true;
          url = c.getURL();
          linkText = c.getTextContent();
        } else if ($isTextNode(c)) {
          leading += c.getTextContent();
        }
      }
      return { hasLink, url, linkText, leading };
    });
    expect(hasLink).toBe(true);
    expect(url).toBe('https://docs.example.com');
    expect(linkText).toBe('the docs');
    expect(leading).toBe('see ');
  });

  it('$highlightInBlock wraps matches in MarkNodes; all:true returns count', () => {
    const { session, ids } = setup('important here important');
    const id = ids[0];
    const count = edit(session, () =>
      $highlightInBlock($blockById(session, id), 'important', { kind: 'all' })
    );
    expect(count).toBe(2);
    const marks = read(session, () => {
      const block = $getRoot().getFirstChild() as ElementNode;
      return block
        .getChildren()
        .filter($isMarkNode)
        .map((c) => c.getTextContent());
    });
    expect(marks).toEqual(['important', 'important']);
  });
});
