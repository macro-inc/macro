import { describe, expect, it } from 'vitest';
import { decodeCanvasPresence } from './presence';

describe('bounded operation lanes on untrusted awareness', () => {
  it('accepts disjoint selected regions and rejects phantom, duplicate and oversized lanes', () => {
    const packet = {
      id: 'peer',
      name: 'Macro (AI)',
      color: '#0891b2',
      cursor: null,
      selectedIds: ['a', 'b', 'c'],
      clock: {},
      preview: null,
      lanes: ['a', 'b', 'c'].map((id) => ({
        id,
        name: id,
        color: '#0891b2',
        itemIds: [id],
        cursor: { x: 0, y: 0 },
      })),
    };
    expect(decodeCanvasPresence(JSON.stringify(packet))?.lanes).toHaveLength(3);
    expect(
      decodeCanvasPresence(
        JSON.stringify({
          ...packet,
          lanes: [{ ...packet.lanes[0], itemIds: ['missing'] }],
        })
      )
    ).toBeNull();
    expect(
      decodeCanvasPresence(
        JSON.stringify({
          ...packet,
          lanes: [packet.lanes[0], { ...packet.lanes[1], itemIds: ['a'] }],
        })
      )
    ).toBeNull();
    expect(
      decodeCanvasPresence(
        JSON.stringify({
          ...packet,
          lanes: [packet.lanes[0], { ...packet.lanes[1], id: 'a' }],
        })
      )
    ).toBeNull();
    expect(
      decodeCanvasPresence(
        JSON.stringify({ ...packet, lanes: [...packet.lanes, packet.lanes[0]] })
      )
    ).toBeNull();
    expect(
      decodeCanvasPresence(
        JSON.stringify({
          ...packet,
          lanes: [{ ...packet.lanes[0], cursor: { x: 'invalid', y: 0 } }],
        })
      )
    ).toBeNull();
  });
});
