import { $createTextNode, $getRoot, $isTextNode } from 'lexical';
import { $isLinkNode } from '@lexical/link';
import { $isMarkNode } from '@lexical/mark';
import { describe, expect, it } from 'vitest';
import { serializeWithIds } from '../utils';
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
import { edit, read, setup } from './_test-helpers';

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
    expect(serializeWithIds(s)).toBe(`the **toad** ate the **toad** {${id}|paragraph}`);
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
    expect(serializeWithIds(s)).toBe(`the toad ate the frog {${id}|paragraph}`);
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
    expect(serializeWithIds(s)).toBe(`the frog ate the toad {${id}|paragraph}`);
  });

  it('$formatTextInBlock — bold a substring (count), no-match returns 0', () => {
    const { s, ids } = setup('the Bluejay launch');
    const id = ids[0];
    const n = edit(s, () =>
      $formatTextInBlock($blockById(s, id), 'Bluejay', 'bold', { all: true })
    );
    expect(n).toBe(1);
    expect(serializeWithIds(s)).toBe(`the **Bluejay** launch {${id}|paragraph}`);

    const miss = edit(s, () =>
      $formatTextInBlock($blockById(s, id), 'Robin', 'bold')
    );
    expect(miss).toBe(0);
  });

  it('$formatTextInBlock — strike maps to strikethrough', () => {
    const { s, ids } = setup('hello world');
    const id = ids[0];
    edit(s, () => $formatTextInBlock($blockById(s, id), 'world', 'strike'));
    expect(serializeWithIds(s)).toBe(`hello ~~world~~ {${id}|paragraph}`);
  });

  it('$clearFormat — removes one format, leaving others', () => {
    // "Bluejay" is bold+italic; clearing bold should leave italic
    const { s, ids } = setup('the ***Bluejay*** launch');
    const id = ids[0];
    const n = edit(s, () =>
      $clearFormat($blockById(s, id), 'Bluejay', 'bold', { all: true })
    );
    expect(n).toBe(1);
    expect(serializeWithIds(s)).toBe(`the *Bluejay* launch {${id}|paragraph}`);
  });

  it('$clearFormat — without format clears all formatting', () => {
    const { s, ids } = setup('the ***Bluejay*** launch');
    const id = ids[0];
    edit(s, () => $clearFormat($blockById(s, id), 'Bluejay'));
    expect(serializeWithIds(s)).toBe(`the Bluejay launch {${id}|paragraph}`);
  });

  it('$replaceString — literal replace, counts, default vs all', () => {
    const { s, ids } = setup('Q3 roadmap and Q3 budget');
    const id = ids[0];
    const n = edit(s, () =>
      $replaceString($blockById(s, id), 'Q3', 'Q4', { all: true })
    );
    expect(n).toBe(2);
    expect(serializeWithIds(s)).toBe(`Q4 roadmap and Q4 budget {${id}|paragraph}`);

    const miss = edit(s, () => $replaceString($blockById(s, id), 'Q9', 'Q1'));
    expect(miss).toBe(0);
  });

  it('formatting a substring preserves surrounding formats, scopes the span', () => {
    // whole "two three four" span is bold; italicize only "three"
    const { s, ids } = setup('one **two three four** five');
    const id = ids[0];
    edit(s, () => $formatTextInBlock($blockById(s, id), 'three', 'italic'));
    const segs = read(s, () => {
      const block = $getRoot().getFirstChild()!;
      const out: Array<{ text: string; bold: boolean; italic: boolean }> = [];
      for (const c of (block as any).getChildren()) {
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
    expect(serializeWithIds(s)).toBe(`**frog** middle **frog** {${id}|paragraph}`);
  });

  it('$appendText / $prependText add text at the ends', () => {
    const { s, ids } = setup('# Meeting Notes');
    const id = ids[0];
    edit(s, () => $appendText($blockById(s, id), ' (draft)'));
    expect(serializeWithIds(s)).toBe(`# Meeting Notes (draft) {${id}|heading}`);
    edit(s, () => $prependText($blockById(s, id), 'DRAFT: '));
    expect(serializeWithIds(s)).toBe(`# DRAFT: Meeting Notes (draft) {${id}|heading}`);
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
      const block = $getRoot().getFirstChild()! as any;
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
      const block = $getRoot().getFirstChild()! as any;
      return block
        .getChildren()
        .filter((c: any) => $isMarkNode(c))
        .map((c: any) => c.getTextContent());
    });
    expect(marks).toEqual(['important', 'important']);
  });
});
