import { $createParagraphNode, $createTextNode } from 'lexical';
import { $createHeadingNode } from '@lexical/rich-text';
import { describe, expect, it } from 'vitest';
import { $getId } from '../../plugins/nodeIdPlugin';
import {
  $appendBlock,
  $blockNode,
  $insertAfter,
  $insertBefore,
  $mergeBlocks,
  $moveBlock,
  $prependBlock,
  $replaceBlock,
  $setBlockType,
  $setText,
  $splitBlock,
} from './blocks';
import { $allById, $blockById, $byId } from './locate';
import { removeLinePrefix, edit, setup, topLevelIds } from './_test-helpers';

describe('block ops', () => {
  it('$blockNode builds a heading at the requested level', () => {
    const { s } = setup('x');
    edit(s, () => {
      const h = $blockNode('heading', { level: 2 });
      expect(h.getType()).toBe('heading');
      expect((h as any).getTag()).toBe('h2');
      // keep the document valid by appending then removing the scratch node
      h.remove();
    });
  });

  it('$setBlockType changes type but KEEPS the id (API: Notes -> ## Notes)', () => {
    const { s, ids } = setup('Notes');
    const id = ids[0];
    edit(s, () =>
      $setBlockType(s, $blockById(s, id), () => $blockNode('heading', { level: 2 }))
    );
    expect(removeLinePrefix(s)).toBe(`## Notes {${id}|heading}`);
    expect(topLevelIds(s)).toEqual([id]); // id preserved
  });

  it('$setText rewrites inline content but KEEPS type and id', () => {
    const { s, ids } = setup('ok so the launch is kinda behind');
    const id = ids[0];
    edit(s, () => $setText($blockById(s, id), 'The launch is behind schedule.'));
    expect(removeLinePrefix(s)).toBe(`The launch is behind schedule. {${id}|paragraph}`);
  });

  it('$replaceBlock replaces type+content with FRESH ids', () => {
    const { s, ids } = setup('ok so the launch is kinda behind');
    const oldId = ids[0];
    edit(s, () => {
      const h2 = $createHeadingNode('h2');
      h2.append($createTextNode('Status'));
      const p = $createParagraphNode();
      p.append($createTextNode('Behind schedule.'));
      $replaceBlock($blockById(s, oldId), h2, p);
    });
    const out = removeLinePrefix(s);
    const lines = out.split('\n\n');
    expect(lines[0]).toMatch(/^## Status \{[^}]+\}$/);
    expect(lines[1]).toMatch(/^Behind schedule\. \{[^}]+\}$/);
    // new ids do not reuse and do not collide with the old one
    const newIds = topLevelIds(s);
    expect(newIds).toHaveLength(2);
    expect(newIds).not.toContain(oldId);
    expect(new Set(newIds).size).toBe(2);
  });

  it('$insertAfter adds blocks after, with fresh non-colliding ids', () => {
    const { s, ids } = setup('- Documentation');
    const before = topLevelIds(s);
    edit(s, () => {
      const h2 = $createHeadingNode('h2');
      h2.append($createTextNode('Recommendation'));
      const p = $createParagraphNode();
      p.append($createTextNode('Ship next week.'));
      $insertAfter($blockById(s, ids[0]), h2, p);
    });
    const after = topLevelIds(s);
    expect(after[0]).toBe(before[0]); // anchor unchanged
    expect(after).toHaveLength(3);
    const fresh = after.slice(1);
    expect(fresh).not.toContain(before[0]);
    expect(new Set(after).size).toBe(3);
    const lines = removeLinePrefix(s).split('\n\n');
    expect(lines[1]).toMatch(/^## Recommendation /);
    expect(lines[2]).toMatch(/^Ship next week\. /);
  });

  it('$insertBefore adds blocks before, with fresh ids', () => {
    const { s, ids } = setup('# Meeting Notes');
    const anchor = ids[0];
    edit(s, () => {
      const h2 = $createHeadingNode('h2');
      h2.append($createTextNode('TL;DR'));
      const p = $createParagraphNode();
      p.append($createTextNode('Shipping next week.'));
      $insertBefore($blockById(s, anchor), h2, p);
    });
    const after = topLevelIds(s);
    expect(after).toHaveLength(3);
    expect(after[2]).toBe(anchor); // anchor still last
    expect(after.slice(0, 2)).not.toContain(anchor);
    expect(new Set(after).size).toBe(3);
    expect(removeLinePrefix(s).split('\n\n')[0]).toMatch(/^## TL;DR /);
  });

  it('$appendBlock adds blocks at the end with fresh ids', () => {
    const { s, ids } = setup('first');
    edit(s, () => {
      const h2 = $createHeadingNode('h2');
      h2.append($createTextNode('Notes'));
      const p = $createParagraphNode();
      p.append($createTextNode('Follow up Friday.'));
      $appendBlock(s, h2, p);
    });
    const after = topLevelIds(s);
    expect(after[0]).toBe(ids[0]);
    expect(after).toHaveLength(3);
    expect(new Set(after).size).toBe(3);
    const lines = removeLinePrefix(s).split('\n\n');
    expect(lines[1]).toMatch(/^## Notes /);
    expect(lines[2]).toMatch(/^Follow up Friday\. /);
  });

  it('$prependBlock adds blocks at the top with fresh ids', () => {
    const { s, ids } = setup('attendees: wolf, sara');
    edit(s, () => {
      const h1 = $createHeadingNode('h1');
      h1.append($createTextNode('Title'));
      $prependBlock(s, h1);
    });
    const after = topLevelIds(s);
    expect(after).toHaveLength(2);
    expect(after[1]).toBe(ids[0]);
    expect(after[0]).not.toBe(ids[0]);
    expect(removeLinePrefix(s).split('\n\n')[0]).toMatch(/^# Title /);
  });

  it('$moveBlock (2-arg) relocates a block after another', () => {
    const { s, ids } = setup('## Decisions\n\nfiller\n\nneed to finalize pricing');
    const [decisions, , pricing] = ids;
    edit(s, () => $moveBlock($byId(s, pricing), { afterId: decisions }));
    expect(topLevelIds(s)).toEqual([decisions, pricing, ids[1]]);
    const lines = removeLinePrefix(s).split('\n\n');
    expect(lines[0]).toMatch(/^## Decisions /);
    expect(lines[1]).toMatch(/^need to finalize pricing /);
  });

  it('$moveBlock supports beforeId', () => {
    const { s, ids } = setup('a\n\nb\n\nc');
    const [a, b, c] = ids;
    edit(s, () => $moveBlock($byId(s, c), { beforeId: a }));
    expect(topLevelIds(s)).toEqual([c, a, b]);
  });

  it('$mergeBlocks merges into the first block, KEEPING its id', () => {
    const { s, ids } = setup("We were behind.\n\nQA hadn't started.");
    const [a, b] = ids;
    const resultId = edit(s, () => {
      const merged = $mergeBlocks($allById(s, [a, b]));
      return $getId(merged);
    });
    expect(resultId).toBe(a); // first block's id preserved
    expect(removeLinePrefix(s)).toBe(`We were behind. QA hadn't started. {${a}|paragraph}`);
  });

  it('$splitBlock keeps first id, gives remainder a fresh id, preserves whitespace', () => {
    const { s, ids } = setup('First, we shipped. Second, we tested.');
    const id = ids[0];
    edit(s, () => $splitBlock($blockById(s, id), 'Second,'));
    // The remainder's fresh id is minted on commit, so read ids after the update.
    const after = topLevelIds(s);
    expect(after).toHaveLength(2);
    const [firstId, secondId] = after;
    expect(firstId).toBe(id); // first half keeps id
    expect(secondId).not.toBe(id); // remainder is fresh
    expect(secondId).toBeTruthy();
    const lines = removeLinePrefix(s).split('\n\n');
    // whitespace preserved verbatim: the space before "Second" stays on first half
    expect(lines[0]).toBe(`First, we shipped.  {${firstId}|paragraph}`);
    expect(lines[1]).toBe(`Second, we tested. {${secondId}|paragraph}`);
  });
});
