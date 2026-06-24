import {
  $createTextNode,
  $getRoot,
  $isTextNode,
  type ElementNode,
} from 'lexical';
import { $isLinkNode } from '@lexical/link';
import { $isMarkNode } from '@lexical/mark';
import { describe, expect, it } from 'vitest';
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
import { $getId } from '../../../../lexical-core/plugins/nodeIdPlugin';
import {
  serializedWithoutLinePrefix,
  edit,
  read,
  setup,
} from './_test-helpers';

// ============================================================================
describe('inline ops: scope + counts', () => {
  it('$replaceTextInBlock — frog -> bold toad, all:true returns 2', () => {
    const { s, ids } = setup('the frog ate the frog');
    const id = ids[0];
    const n = edit(s, () =>
      $replaceTextInBlock(
        $blockById(s, id),
        'frog',
        () => $createTextNode('toad').toggleFormat('bold'),
        { all: true }
      )
    );
    expect(n).toBe(2);
    expect(serializedWithoutLinePrefix(s)).toBe(
      `the **toad** ate the **toad** {${id}|paragraph}`
    );
  });

  it('$replaceTextInBlock — default targets only the first match (count 1)', () => {
    const { s, ids } = setup('the frog ate the frog');
    const id = ids[0];
    const n = edit(s, () =>
      $replaceTextInBlock($blockById(s, id), 'frog', () =>
        $createTextNode('toad')
      )
    );
    expect(n).toBe(1);
    expect(serializedWithoutLinePrefix(s)).toBe(
      `the toad ate the frog {${id}|paragraph}`
    );
  });

  it('$replaceTextInBlock — { nth } is 1-based', () => {
    const { s, ids } = setup('the frog ate the frog');
    const id = ids[0];
    const n = edit(s, () =>
      $replaceTextInBlock(
        $blockById(s, id),
        'frog',
        () => $createTextNode('toad'),
        { nth: 2 }
      )
    );
    expect(n).toBe(1);
    expect(serializedWithoutLinePrefix(s)).toBe(
      `the frog ate the toad {${id}|paragraph}`
    );
  });

  it('$formatTextInBlock — bold a substring (count), no-match returns 0', () => {
    const { s, ids } = setup('the Bluejay launch');
    const id = ids[0];
    const n = edit(s, () =>
      $formatTextInBlock($blockById(s, id), 'Bluejay', 'bold', { all: true })
    );
    expect(n).toBe(1);
    expect(serializedWithoutLinePrefix(s)).toBe(
      `the **Bluejay** launch {${id}|paragraph}`
    );

    const miss = edit(s, () =>
      $formatTextInBlock($blockById(s, id), 'Robin', 'bold')
    );
    expect(miss).toBe(0);
  });

  it('$formatTextInBlock — strike maps to strikethrough', () => {
    const { s, ids } = setup('hello world');
    const id = ids[0];
    edit(s, () => $formatTextInBlock($blockById(s, id), 'world', 'strike'));
    expect(serializedWithoutLinePrefix(s)).toBe(
      `hello ~~world~~ {${id}|paragraph}`
    );
  });

  it('$clearFormat — removes one format, leaving others', () => {
    // "Bluejay" is bold+italic; clearing bold should leave italic
    const { s, ids } = setup('the ***Bluejay*** launch');
    const id = ids[0];
    const n = edit(s, () =>
      $clearFormat($blockById(s, id), 'Bluejay', 'bold', { all: true })
    );
    expect(n).toBe(1);
    expect(serializedWithoutLinePrefix(s)).toBe(
      `the *Bluejay* launch {${id}|paragraph}`
    );
  });

  it('$clearFormat — without format clears all formatting', () => {
    const { s, ids } = setup('the ***Bluejay*** launch');
    const id = ids[0];
    edit(s, () => $clearFormat($blockById(s, id), 'Bluejay'));
    expect(serializedWithoutLinePrefix(s)).toBe(
      `the Bluejay launch {${id}|paragraph}`
    );
  });

  it('$replaceString — literal replace, counts, default vs all', () => {
    const { s, ids } = setup('Q3 roadmap and Q3 budget');
    const id = ids[0];
    const n = edit(s, () =>
      $replaceString($blockById(s, id), 'Q3', 'Q4', { all: true })
    );
    expect(n).toBe(2);
    expect(serializedWithoutLinePrefix(s)).toBe(
      `Q4 roadmap and Q4 budget {${id}|paragraph}`
    );

    const miss = edit(s, () => $replaceString($blockById(s, id), 'Q9', 'Q1'));
    expect(miss).toBe(0);
  });

  it('$replaceString mutates in place — text node ids survive (no churn)', () => {
    const { s, ids } = setup('Full control over rendering');
    const id = ids[0];
    const before = read(s, () =>
      collectTextNodes($blockById(s, id)).map((n) => $getId(n))
    );
    edit(s, () => $replaceString($blockById(s, id), 'Full ', ''));
    const after = read(s, () =>
      collectTextNodes($blockById(s, id)).map((n) => $getId(n))
    );
    expect(after).toEqual(before); // same leaf ids — the diff sees a clean setText
    expect(read(s, () => $blockById(s, id).getTextContent())).toBe(
      'control over rendering'
    );
  });

  it('$appendText / $prependText extend an existing plain text node in place', () => {
    const { s, ids } = setup('Meeting Notes');
    const id = ids[0];
    const before = read(s, () =>
      collectTextNodes($blockById(s, id)).map((n) => $getId(n))
    );
    edit(s, () => $appendText($blockById(s, id), ' (draft)'));
    edit(s, () => $prependText($blockById(s, id), 'DRAFT: '));
    const after = read(s, () =>
      collectTextNodes($blockById(s, id)).map((n) => $getId(n))
    );
    expect(after).toEqual(before); // no new text nodes minted
    expect(read(s, () => $blockById(s, id).getTextContent())).toBe(
      'DRAFT: Meeting Notes (draft)'
    );
  });

  it('formatting a substring preserves surrounding formats, scopes the span', () => {
    // whole "two three four" span is bold; italicize only "three"
    const { s, ids } = setup('one **two three four** five');
    const id = ids[0];
    edit(s, () => $formatTextInBlock($blockById(s, id), 'three', 'italic'));
    const segs = read(s, () => {
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
    const { s, ids } = setup('frog middle frog');
    const id = ids[0];
    const n = edit(s, () =>
      $formatTextInBlock($blockById(s, id), 'frog', 'bold', { all: true })
    );
    expect(n).toBe(2);
    expect(serializedWithoutLinePrefix(s)).toBe(
      `**frog** middle **frog** {${id}|paragraph}`
    );
  });

  it('scoped first-match does not bleed when needle repeats in the same text node', () => {
    // "XX" is one TextNode; formatting "X" with default scope (first only) must
    // not touch the second X even though both pieces equal the needle after splitting.
    const { s, ids } = setup('XX');
    const id = ids[0];
    const n = edit(s, () => $formatTextInBlock($blockById(s, id), 'X', 'bold'));
    expect(n).toBe(1);
    const segs = read(s, () => {
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
    const { s, ids } = setup('# Meeting Notes');
    const id = ids[0];
    edit(s, () => $appendText($blockById(s, id), ' (draft)'));
    expect(serializedWithoutLinePrefix(s)).toBe(
      `# Meeting Notes (draft) {${id}|heading}`
    );
    edit(s, () => $prependText($blockById(s, id), 'DRAFT: '));
    expect(serializedWithoutLinePrefix(s)).toBe(
      `# DRAFT: Meeting Notes (draft) {${id}|heading}`
    );
  });
});

// ============================================================================
// Links and marks do NOT round-trip through serializeWithIds, so inspect the
// node tree with $isLinkNode / $isMarkNode.
describe('deferred: links / highlight (node-tree assertions)', () => {
  it('$wrapInLink wraps a substring in a LinkNode; count returned', () => {
    const { s, ids } = setup('see the docs');
    const id = ids[0];
    const n = edit(s, () =>
      $wrapInLink($blockById(s, id), 'the docs', 'https://docs.example.com')
    );
    expect(n).toBe(1);
    const { hasLink, url, linkText, leading } = read(s, () => {
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
    const { s, ids } = setup('important here important');
    const id = ids[0];
    const n = edit(s, () =>
      $highlightInBlock($blockById(s, id), 'important', { all: true })
    );
    expect(n).toBe(2);
    const marks = read(s, () => {
      const block = $getRoot().getFirstChild() as ElementNode;
      return block
        .getChildren()
        .filter($isMarkNode)
        .map((c) => c.getTextContent());
    });
    expect(marks).toEqual(['important', 'important']);
  });
});
