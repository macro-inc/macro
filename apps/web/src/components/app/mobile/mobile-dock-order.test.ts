import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createMobileDockOrder,
  dockVisibleCount,
  normalizeDockOrder,
} from './mobile-dock-order';

const defaults = ['home', 'calendar', 'mail', 'tasks', 'reviews'];
beforeEach(() => localStorage.clear());

describe('mobile dock preferences', () => {
  it('deduplicates saved entries, ignores unknown ids, and appends new views', () => {
    expect(
      normalizeDockOrder(['tasks', 'tasks', 'old-view', 'home'], defaults)
    ).toEqual(['tasks', 'home', 'calendar', 'mail', 'reviews']);
  });
  it('preserves gated positions while reordering enabled destinations', () => {
    const prefs = createMobileDockOrder('alice', defaults);
    prefs.move(2, 0, ['home', 'mail', 'tasks']);
    expect(prefs.order()).toEqual([
      'tasks',
      'calendar',
      'home',
      'mail',
      'reviews',
    ]);
    expect(createMobileDockOrder('alice', defaults).order()).toEqual(
      prefs.order()
    );
    expect(createMobileDockOrder('bob', defaults).order()).toEqual(defaults);
    expect(createMobileDockOrder(undefined, defaults).order()).toEqual(
      defaults
    );
  });
  it.each(['not json', '{}', '[1,2]'])(
    'recovers from malformed storage: %s',
    (stored) => {
      localStorage.setItem('macro:mobile:dock-order:alice', stored);
      expect(createMobileDockOrder('alice', defaults).order()).toEqual(
        defaults
      );
    }
  );
  it('keeps the in-memory order when storage fails and ignores invalid moves', () => {
    const prefs = createMobileDockOrder('alice', defaults);
    const write = vi
      .spyOn(Storage.prototype, 'setItem')
      .mockImplementation(() => {
        throw new Error('blocked');
      });
    prefs.move(0, -1, defaults);
    prefs.move(0, defaults.length, defaults);
    expect(prefs.order()).toEqual(defaults);
    prefs.move(3, 0, defaults);
    expect(prefs.order()[0]).toBe('tasks');
    write.mockRestore();
  });
});

it('reserves More, clamps to enabled items, and handles unmeasured or narrow docks', () => {
  expect(dockVisibleCount(null, null, 10)).toBe(0);
  expect(dockVisibleCount(30, 44, 10)).toBe(0);
  expect(dockVisibleCount(220, 44, 10)).toBe(4);
  expect(dockVisibleCount(219, 44, 10)).toBe(3);
  expect(dockVisibleCount(440, 44, 3)).toBe(3);
});
