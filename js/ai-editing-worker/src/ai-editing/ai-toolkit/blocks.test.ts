import { $createHeadingNode } from '@lexical/rich-text';
import { $createParagraphNode, $createTextNode } from 'lexical';
import { describe, expect, it } from 'vitest';
import { $getId } from '../../../../lexical-core/plugins/nodeIdPlugin';
import { serializeWithXml } from '../utils';
import { edit, read, setup, topLevelIds } from './_test-helpers';
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
} from './blocks';
import { $allById, $blockById, $byId } from './locate';

describe('block ops', () => {
  it('$setBlockType changes type, mints a FRESH id, and forwards the old id to it', () => {
    const { session, ids } = setup('Notes');
    const id = ids[0]!;
    edit(session, () =>
      $setBlockType(session, $blockById(session, id), () =>
        $blockNode({ type: 'heading', level: 2 })
      )
    );
    const xml = serializeWithXml(session);
    expect(xml).toContain('<h2');
    expect(xml).toContain('Notes');
    // The replacement carries a fresh durable id; the old id is gone from the doc
    // (so a CRDT sync reads delete+insert, not an in-place reshape).
    const [newId] = topLevelIds(session);
    expect(newId).not.toBe(id);
    expect(xml).not.toContain(`id="${id}"`);
    // ...but the old id still resolves to the new node (forwarded in the id map).
    expect(read(session, () => $getId($blockById(session, id)))).toBe(newId);
  });

  it('$setText rewrites inline content but KEEPS type and id', () => {
    const { session, ids } = setup('ok so the launch is kinda behind');
    const id = ids[0];
    edit(session, () =>
      $setText($blockById(session, id), 'The launch is behind schedule.')
    );
    const xml = serializeWithXml(session);
    expect(xml).toContain('The launch is behind schedule.');
    expect(xml).toContain(`id="${id}"`);
  });

  it('$replaceBlock replaces type+content with FRESH ids', () => {
    const { session, ids } = setup('ok so the launch is kinda behind');
    const oldId = ids[0];
    edit(session, () => {
      const h2 = $createHeadingNode('h2');
      h2.append($createTextNode('Status'));
      const p = $createParagraphNode();
      p.append($createTextNode('Behind schedule.'));
      $replaceBlock($blockById(session, oldId), h2, p);
    });
    const xml = serializeWithXml(session);
    expect(xml).toContain('<h2');
    expect(xml).toContain('Status');
    expect(xml).toContain('Behind schedule.');
    // new ids do not reuse and do not collide with the old one
    const newIds = topLevelIds(session);
    expect(newIds).toHaveLength(2);
    expect(newIds).not.toContain(oldId);
    expect(new Set(newIds).size).toBe(2);
  });

  it('$insertAfter adds blocks after, with fresh non-colliding ids', () => {
    const { session, ids } = setup('- Documentation');
    const before = topLevelIds(session);
    edit(session, () => {
      const h2 = $createHeadingNode('h2');
      h2.append($createTextNode('Recommendation'));
      const p = $createParagraphNode();
      p.append($createTextNode('Ship next week.'));
      $insertAfter($blockById(session, ids[0]), h2, p);
    });
    const after = topLevelIds(session);
    expect(after[0]).toBe(before[0]); // anchor unchanged
    expect(after).toHaveLength(3);
    const fresh = after.slice(1);
    expect(fresh).not.toContain(before[0]);
    expect(new Set(after).size).toBe(3);
    const xml = serializeWithXml(session);
    expect(xml).toContain('<h2');
    expect(xml).toContain('Recommendation');
    expect(xml).toContain('Ship next week.');
  });

  it('$insertBefore adds blocks before, with fresh ids', () => {
    const { session, ids } = setup('# Meeting Notes');
    const anchor = ids[0];
    edit(session, () => {
      const h2 = $createHeadingNode('h2');
      h2.append($createTextNode('TL;DR'));
      const p = $createParagraphNode();
      p.append($createTextNode('Shipping next week.'));
      $insertBefore($blockById(session, anchor), h2, p);
    });
    const after = topLevelIds(session);
    expect(after).toHaveLength(3);
    expect(after[2]).toBe(anchor); // anchor still last
    expect(after.slice(0, 2)).not.toContain(anchor);
    expect(new Set(after).size).toBe(3);
    const xml = serializeWithXml(session);
    expect(xml).toContain('<h2');
    expect(xml).toContain('TL;DR');
  });

  it('$appendBlock adds blocks at the end with fresh ids', () => {
    const { session, ids } = setup('first');
    edit(session, () => {
      const h2 = $createHeadingNode('h2');
      h2.append($createTextNode('Notes'));
      const p = $createParagraphNode();
      p.append($createTextNode('Follow up Friday.'));
      $appendBlock(h2, p);
    });
    const after = topLevelIds(session);
    expect(after[0]).toBe(ids[0]);
    expect(after).toHaveLength(3);
    expect(new Set(after).size).toBe(3);
    const xml = serializeWithXml(session);
    expect(xml).toContain('<h2');
    expect(xml).toContain('Notes');
    expect(xml).toContain('Follow up Friday.');
  });

  it('$prependBlock adds blocks at the top with fresh ids', () => {
    const { session, ids } = setup('attendees: wolf, sara');
    edit(session, () => {
      const h1 = $createHeadingNode('h1');
      h1.append($createTextNode('Title'));
      $prependBlock(h1);
    });
    const after = topLevelIds(session);
    expect(after).toHaveLength(2);
    expect(after[1]).toBe(ids[0]);
    expect(after[0]).not.toBe(ids[0]);
    const xml = serializeWithXml(session);
    expect(xml).toContain('<h1');
    expect(xml).toContain('Title');
  });

  it('$moveBlock (2-arg) relocates a block after another', () => {
    const { session, ids } = setup(
      '## Decisions\n\nfiller\n\nneed to finalize pricing'
    );
    const [decisions, , pricing] = ids;
    edit(session, () =>
      $moveBlock($byId(session, pricing), { placement: 'after', id: decisions })
    );
    expect(topLevelIds(session)).toEqual([decisions, pricing, ids[1]]);
    const xml = serializeWithXml(session);
    expect(xml).toContain('Decisions');
    expect(xml).toContain('need to finalize pricing');
  });

  it('$moveBlock supports beforeId', () => {
    const { session, ids } = setup('a\n\nb\n\nc');
    const [idA, idB, idC] = ids;
    edit(session, () =>
      $moveBlock($byId(session, idC), { placement: 'before', id: idA })
    );
    expect(topLevelIds(session)).toEqual([idC, idA, idB]);
  });

  it('$mergeBlocks merges into the first block, KEEPING its id', () => {
    const { session, ids } = setup("We were behind.\n\nQA hadn't started.");
    const [idA, idB] = ids;
    const resultId = edit(session, () => {
      const merged = $mergeBlocks($allById(session, [idA, idB]));
      return $getId(merged);
    });
    expect(resultId).toBe(idA); // first block's id preserved
    const xml = serializeWithXml(session);
    expect(xml).toContain(`id="${idA}"`);
    expect(xml).toContain('We were behind.');
    expect(xml).toContain('QA hadn');
  });
});
