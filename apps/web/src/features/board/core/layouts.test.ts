import { describe, expect, it } from 'vitest';
import { author, boardItem, HOUR, MINUTE, message, NOW } from '../tests/items';
import { type Bounds, fitCamera, zoomCameraAt } from './camera';
import { masonry, spiralPack } from './geometry';
import type { BoardItem } from './item';
import { orderWithGroups } from './item';
import { layoutBubbles } from './layout-bubbles';
import { layoutNeighborhoods } from './layout-neighborhoods';
import { layoutRadar, radarRing } from './layout-radar';
import { layoutRiver, RIVER_SEGMENT, riverX } from './layout-river';
import { gatherPeople, layoutPeople } from './people';

const overlaps = (a: Bounds, b: Bounds) =>
  a.x < b.x + b.width &&
  b.x < a.x + a.width &&
  a.y < b.y + b.height &&
  b.y < a.y + a.height;

function expectNoOverlaps(rects: Bounds[]) {
  rects.forEach((rect, index) => {
    for (const other of rects.slice(index + 1)) {
      expect(overlaps(rect, other)).toBe(false);
    }
  });
}

function mixedItems(): BoardItem[] {
  return [
    ...Array.from({ length: 9 }, (_, index) =>
      boardItem(`channel:${index}`, {
        lastActivityAt: NOW - index * 20 * MINUTE,
        unreadCount: index % 3 === 0 ? 2 : 0,
      })
    ),
    ...Array.from({ length: 4 }, (_, index) =>
      boardItem(`email:${index}`, {
        zone: 'email',
        kind: 'email',
        lastActivityAt: NOW - index * 2 * HOUR,
      })
    ),
    boardItem('dm:1', { zone: 'dms', kind: 'dm', needsYou: true }),
    boardItem('doc:1', { zone: 'docs', kind: 'document' }),
  ];
}

describe('masonry', () => {
  it('fills the shortest column first', () => {
    const { placements, size } = masonry(
      [
        { width: 10, height: 100 },
        { width: 10, height: 20 },
        { width: 10, height: 20 },
      ],
      { columns: 2, columnWidth: 10, gap: 5 }
    );

    expect(placements.map(({ x, y }) => [x, y])).toEqual([
      [0, 0],
      [15, 0],
      [15, 25],
    ]);
    expect(size).toEqual({ width: 25, height: 100 });
  });
});

describe('spiralPack', () => {
  it('places the first circle in the middle and keeps the rest apart', () => {
    const circles = spiralPack([40, 30, 30, 20, 20, 20], { margin: 6 });

    expect(circles[0]).toEqual({ x: 0, y: 0, r: 40 });
    circles.forEach((circle, index) => {
      for (const other of circles.slice(index + 1)) {
        expect(
          Math.hypot(circle.x - other.x, circle.y - other.y)
        ).toBeGreaterThanOrEqual(circle.r + other.r + 6 - 1e-6);
      }
    });
  });
});

describe('camera', () => {
  it('fits bounds into the viewport without enlarging past the cap', () => {
    const camera = fitCamera(
      { x: 0, y: 0, width: 200, height: 100 },
      { width: 1000, height: 800 },
      { padding: 0 }
    );

    expect(camera).toEqual({ x: 400, y: 350, scale: 1 });
  });

  it('keeps the world point under the cursor fixed while zooming', () => {
    const camera = zoomCameraAt({ x: 0, y: 0, scale: 1 }, { x: 100, y: 50 }, 2);

    expect(camera).toEqual({ x: -100, y: -50, scale: 2 });
  });
});

describe('orderWithGroups', () => {
  it('keeps a thread beside its channel', () => {
    const ordered = orderWithGroups([
      boardItem('channel:a', { groupKey: 'a', lastActivityAt: NOW - HOUR }),
      boardItem('channel:b', { lastActivityAt: NOW - MINUTE }),
      boardItem('thread:a1', {
        groupKey: 'a',
        kind: 'thread',
        lastActivityAt: NOW - 2 * HOUR,
      }),
    ]);

    expect(ordered.map((item) => item.key)).toEqual([
      'channel:b',
      'channel:a',
      'thread:a1',
    ]);
  });
});

describe('layoutNeighborhoods', () => {
  it('frames each neighborhood around its cards without overlaps', () => {
    const layout = layoutNeighborhoods(mixedItems(), () => undefined);

    expect(layout.zones.map((zone) => zone.zone)).toEqual([
      'channels',
      'dms',
      'email',
      'docs',
    ]);
    expectNoOverlaps(layout.zones.map((zone) => zone.bounds));
    expectNoOverlaps([...layout.cards.values()]);
    for (const zone of layout.zones) {
      const cards = mixedItems()
        .filter((item) => item.zone === zone.zone)
        .map((item) => layout.cards.get(item.key));
      for (const card of cards) {
        expect(card).toBeDefined();
        if (!card) continue;
        expect(card.x).toBeGreaterThanOrEqual(zone.bounds.x);
        expect(card.y + card.height).toBeLessThanOrEqual(
          zone.bounds.y + zone.bounds.height
        );
      }
    }
  });

  it('uses measured heights once cards have rendered', () => {
    const estimated = layoutNeighborhoods([boardItem('a')], () => undefined);
    const measured = layoutNeighborhoods([boardItem('a')], () => ({
      width: 288,
      height: 400,
    }));

    expect(measured.cards.get('a')?.height).toBe(400);
    expect(estimated.cards.get('a')?.height).not.toBe(400);
  });
});

describe('layoutBubbles', () => {
  it('gives louder conversations bigger faces', () => {
    const layout = layoutBubbles(
      [
        boardItem('quiet', { lastActivityAt: NOW - 20 * HOUR }),
        boardItem('loud', {
          lastActivityAt: NOW - MINUTE,
          unreadCount: 6,
          needsYou: true,
        }),
      ],
      NOW
    );

    expect(layout.nodes.get('loud')?.r).toBeGreaterThan(
      layout.nodes.get('quiet')?.r ?? Infinity
    );
  });

  it('keeps neighborhood clusters apart', () => {
    const layout = layoutBubbles(mixedItems(), NOW);

    layout.clusters.forEach((cluster, index) => {
      for (const other of layout.clusters.slice(index + 1)) {
        expect(
          Math.hypot(cluster.x - other.x, cluster.y - other.y)
        ).toBeGreaterThanOrEqual(cluster.r + other.r);
      }
    });
  });
});

describe('layoutRiver', () => {
  it('maps age to the left of now with equal-width segments', () => {
    expect(riverX(0)).toBe(-0);
    expect(riverX(15 * MINUTE)).toBe(-RIVER_SEGMENT);
    expect(riverX(37.5 * MINUTE)).toBe(-1.5 * RIVER_SEGMENT);
    expect(riverX(Infinity)).toBe(-8 * RIVER_SEGMENT);
  });

  it('stacks chips that would collide instead of overlapping them', () => {
    const items = Array.from({ length: 5 }, (_, index) =>
      boardItem(`c${index}`, { lastActivityAt: NOW - index * MINUTE })
    );
    const layout = layoutRiver(items, NOW, () => undefined);

    expectNoOverlaps([...layout.chips.values()]);
    expect(layout.lanes).toHaveLength(1);
  });
});

describe('layoutRadar', () => {
  it('puts what needs you on the innermost ring', () => {
    const layout = layoutRadar(mixedItems(), NOW);
    const distance = (key: string) => {
      const node = layout.nodes.get(key);
      return node ? Math.hypot(node.x, node.y) : NaN;
    };

    expect(radarRing(boardItem('dm', { needsYou: true }), NOW)).toBe(
      'needs-you'
    );
    expect(distance('dm:1')).toBeLessThan(distance('email:3'));
    expect(layout.sectors.map((sector) => sector.zone)).toEqual([
      'channels',
      'dms',
      'email',
      'docs',
    ]);
  });
});

describe('gatherPeople', () => {
  it("collects each person's lines across conversations, without the viewer", () => {
    const ana = author('Ana');
    const me = author('Me', { isSelf: true });
    const people = gatherPeople([
      boardItem('channel:a', {
        messages: [
          message('first', { author: ana, at: NOW - HOUR }),
          message('mine', { author: me, at: NOW - 30 * MINUTE }),
        ],
      }),
      boardItem('email:b', {
        zone: 'email',
        messages: [
          message('second', { author: ana, at: NOW - MINUTE, unread: true }),
        ],
      }),
    ]);

    expect(people).toHaveLength(1);
    expect(people[0].lines.map((line) => line.message.text)).toEqual([
      'second',
      'first',
    ]);
    expect(people[0].unreadCount).toBe(1);

    const layout = layoutPeople(people, () => undefined);
    expect(layout.cards.get(people[0].key)).toBeDefined();
  });
});
