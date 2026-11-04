import { $getId } from '@macro-inc/lexical-core/plugins/nodeIdPlugin';
import { describe, expect, it } from 'vitest';
import { serializeWithXml } from '../utils';
import { edit, read, setup, topLevelIds } from './_test-helpers';
import { $blockNode, $mergeBlocks, $setBlockType, $setText } from './blocks';
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
