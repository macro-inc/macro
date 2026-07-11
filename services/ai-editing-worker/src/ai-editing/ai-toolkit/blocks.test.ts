import { $createHeadingNode } from '@lexical/rich-text';
import { $getId } from '@lexical-core/plugins/nodeIdPlugin';
import { $createParagraphNode, $createTextNode } from 'lexical';
import { describe, expect, it } from 'vitest';
import { serializeWithXml } from '../utils';
import { edit, read, setup, topLevelIds } from './_test-helpers';
import {
  $appendBlock,
  $blockNode,
  $mergeBlocks,
  $moveBlock,
  $prependBlock,
  $setBlockType,
  $setText,
} from './blocks';
import { $blockById, $byId } from './locate';

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
      const merged = $mergeBlocks([idA, idB].map((id) => $byId(session, id)));
      return $getId(merged);
    });
    expect(resultId).toBe(idA); // first block's id preserved
    expect(serializeWithXml(session)).toContain(`id="${idA}"`);
    // both bodies land in the one surviving block, joined by the ' ' separator
    const mergedText = read(session, () =>
      $blockById(session, idA!).getTextContent()
    );
    expect(mergedText).toBe("We were behind. QA hadn't started.");
  });
});
