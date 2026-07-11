import { $createLinkNode } from '@lexical/link';
import { $createMarkNode } from '@lexical/mark';
import { $getId } from '@lexical-core/plugins/nodeIdPlugin';
import { $getRoot, $isTextNode, type ElementNode } from 'lexical';
import { describe, expect, it } from 'vitest';
import { serializeWithXml } from '../utils';
import { edit, read, setup } from './_test-helpers';
import {
  $appendText,
  $clearFormat,
  $formatTextInBlock,
  $prependText,
  $replaceString,
  $wrapInBlock,
} from './inline';
import { $blockById } from './locate';

describe('inline ops: scope + counts', () => {
  it('$formatTextInBlock — bold a substring (count), no-match returns 0', () => {
    const { session, ids } = setup('the Bluejay launch');
    const id = ids[0];
    const count = edit(session, () =>
      $formatTextInBlock($blockById(session, id), 'Bluejay', 'bold', {
        kind: 'all',
      })
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
    expect(read(session, () => bluejayNode!.hasFormat('bold'))).toBe(true);
    expect(serializeWithXml(session)).toContain(`id="${id}"`);
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
      $blockById(session, id)
        .getAllTextNodes()
        .map((n) => $getId(n))
    );
    edit(session, () => $replaceString($blockById(session, id), 'Full ', ''));
    const after = read(session, () =>
      $blockById(session, id)
        .getAllTextNodes()
        .map((n) => $getId(n))
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
      $blockById(session, id)
        .getAllTextNodes()
        .map((n) => $getId(n))
    );
    edit(session, () => $appendText($blockById(session, id), ' (draft)'));
    edit(session, () => $prependText($blockById(session, id), 'DRAFT: '));
    const after = read(session, () =>
      $blockById(session, id)
        .getAllTextNodes()
        .map((n) => $getId(n))
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
});

describe('links / highlight', () => {
  it('$wrapInBlock wraps a substring in a LinkNode; count returned', () => {
    const { session, ids } = setup('see the docs');
    const id = ids[0];
    const count = edit(session, () =>
      $wrapInBlock($blockById(session, id), 'the docs', () =>
        $createLinkNode('https://docs.example.com')
      )
    );
    expect(count).toBe(1);
    const xml = serializeWithXml(session);
    expect(xml).toContain('href="https://docs.example.com"');
    // the link wraps 'the docs', leaving 'see ' as a sibling text node
    expect(xml).toMatch(/see /);
    expect(xml).toMatch(/<a[^>]*>[\s\S]*the docs[\s\S]*<\/a>/);
  });

  it('$wrapInBlock wraps matches in MarkNodes; all:true returns count', () => {
    const { session, ids } = setup('important here important');
    const id = ids[0];
    const count = edit(session, () =>
      $wrapInBlock($blockById(session, id), 'important', $createMarkNode, {
        kind: 'all',
      })
    );
    expect(count).toBe(2);
    const xml = serializeWithXml(session);
    expect(xml.match(/<mark/g)).toHaveLength(2);
    expect(xml).toMatch(/<mark[^>]*>[\s\S]*important[\s\S]*<\/mark>/);
  });
});
