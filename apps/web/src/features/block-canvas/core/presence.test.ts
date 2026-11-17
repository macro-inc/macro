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

describe('preview ghosts on untrusted awareness', () => {
  const frame = (shape: Record<string, unknown>) =>
    JSON.stringify({
      id: 'peer',
      name: 'Macro (AI)',
      color: '#0891b2',
      cursor: null,
      selectedIds: ['node'],
      clock: {},
      preview: {
        kind: 'ai',
        box: null,
        shapes: [{ id: 'node', world: [1, 0, 0, 1, 40, 60], ...shape }],
      },
    });

  it('admits a bounds-only ghost the overlay can render', () => {
    expect(
      decodeCanvasPresence(
        frame({ kind: 'rectangle', width: 960, height: 600 })
      )?.preview?.shapes
    ).toHaveLength(1);
  });

  it('drops a frame whose bounds-only ghost has no area instead of crashing the canvas', () => {
    expect(
      decodeCanvasPresence(frame({ kind: 'rectangle', width: 0, height: 0 }))
    ).toBeNull();
    expect(
      decodeCanvasPresence(frame({ kind: 'ellipse', width: 10, height: 0 }))
    ).toBeNull();
  });

  it('still admits a growing ghost whose payload the overlay sizes itself', () => {
    expect(
      decodeCanvasPresence(
        frame({
          kind: 'rectangle',
          width: 0,
          height: 0,
          item: {
            type: 'rectangle',
            geometry: JSON.stringify({ width: 100, height: 80 }),
            appearance: { fill: '#ffffff', stroke: '#171717' },
          },
        })
      )?.preview?.shapes
    ).toHaveLength(1);
  });
});
