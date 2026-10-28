import { describe, expect, it } from 'vitest';
import { createHistory } from '../history';

describe('createHistory', () => {
  it('should create an empty history', () => {
    const history = createHistory<{ value: string }>();
    expect(history.items).toEqual([]);
    expect(history.index).toBe(-1);
    expect(history.canGoBack()).toBe(false);
    expect(history.canGoForward()).toBe(false);
  });

  describe('configured availability', () => {
    it('uses the current rule for both navigation and availability checks', () => {
      const unavailable = new Set(['middle']);
      const history = createHistory<{ value: string }>({
        canVisit: (item) => !unavailable.has(item.value),
      });
      for (const value of ['first', 'middle', 'last']) history.push({ value });
      expect(history.canGoBack()).toBe(true);
      expect(history.back()).toEqual({ value: 'first' });
      expect(history.canGoForward()).toBe(true);
      expect(history.forward()).toEqual({ value: 'last' });
      expect(history.items).toHaveLength(3);

      unavailable.add('first');
      expect(history.canGoBack()).toBe(false);
      expect(history.back()).toBeNull();
      expect(history.index).toBe(2);

      unavailable.clear();
      expect(history.back()).toEqual({ value: 'middle' });
      unavailable.add('last');
      expect(history.canGoForward()).toBe(false);
      expect(history.forward()).toBeNull();
      unavailable.clear();
      expect(history.canGoForward()).toBe(true);
      expect(history.forward()).toEqual({ value: 'last' });
    });

    it('combines backTo destinations with the configured availability rule', () => {
      const history = createHistory<{ value: string; available: boolean }>({
        canVisit: (item) => item.available,
      });
      history.push({ value: 'list', available: true });
      history.push({ value: 'list', available: false });
      history.push({ value: 'detail', available: true });
      expect(history.backTo((item) => item.value === 'list')).toEqual({
        value: 'list',
        available: true,
      });
      expect(history.index).toBe(0);
    });

    it('refuses removal that would activate an unavailable entry', () => {
      let available = false;
      const history = createHistory<{ value: string }>({
        canVisit: () => available,
      });
      history.push({ value: 'first' });
      history.push({ value: 'last' });
      expect(history.remove((item) => item.value === 'last')).toBeNull();
      expect(history.items).toHaveLength(2);
      expect(history.index).toBe(1);
      available = true;
      expect(history.remove((item) => item.value === 'last')).toEqual({
        value: 'first',
      });
      expect(history.index).toBe(0);
    });
  });

  describe('push', () => {
    it('should add items to history', () => {
      const history = createHistory<{ value: string }>();

      history.push({ value: 'first' });
      expect(history.items).toEqual([{ value: 'first' }]);
      expect(history.index).toBe(0);

      history.push({ value: 'second' });
      expect(history.items).toEqual([{ value: 'first' }, { value: 'second' }]);
      expect(history.index).toBe(1);
    });

    it('should fork from item when not at end of history', () => {
      const history = createHistory<{ value: string }>();

      history.push({ value: 'first' });
      history.push({ value: 'second' });
      history.push({ value: 'third' });
      expect(history.items.length).toBe(3);
      expect(history.index).toBe(2);

      history.back();
      history.back();
      expect(history.items.length).toBe(3);
      expect(history.index).toBe(0);

      history.push({ value: 'new' });
      expect(history.items).toEqual([{ value: 'first' }, { value: 'new' }]);
    });
  });

  describe('back', () => {
    it('should navigate backward in history', () => {
      const history = createHistory<{ value: string }>();

      history.push({ value: 'first' });
      history.push({ value: 'second' });
      history.push({ value: 'third' });

      const result1 = history.back();
      expect(result1).toEqual({ value: 'second' });

      const result2 = history.back();
      expect(result2).toEqual({ value: 'first' });
    });
  });

  describe('backTo', () => {
    it('jumps to the nearest earlier match, keeping the skipped entries forward', () => {
      const history = createHistory<{ value: string }>();

      history.push({ value: 'inbox' });
      history.push({ value: 'doc' });
      history.push({ value: 'tasks' });
      history.push({ value: 'task' });
      history.push({ value: 'thread' });

      const result = history.backTo((item) => item.value === 'tasks');
      expect(result).toEqual({ value: 'tasks' });
      expect(history.index).toBe(2);
      expect(history.items).toHaveLength(5);
      expect(history.forward()).toEqual({ value: 'task' });
    });

    it('stays put when no earlier entry matches', () => {
      const history = createHistory<{ value: string }>();

      history.push({ value: 'doc' });
      history.push({ value: 'thread' });

      expect(history.backTo((item) => item.value === 'inbox')).toBe(null);
      expect(history.index).toBe(1);
    });

    it('ignores the current entry and anything ahead of it', () => {
      const history = createHistory<{ value: string }>();

      history.push({ value: 'doc' });
      history.push({ value: 'inbox' });
      history.push({ value: 'thread' });
      history.push({ value: 'inbox' });
      // Sitting on 'inbox' at index 1, with another 'inbox' ahead at index 3.
      history.back();
      history.back();

      expect(history.backTo((item) => item.value === 'inbox')).toBe(null);
      expect(history.index).toBe(1);
    });
  });

  describe('forward', () => {
    it('should navigate forward in history', () => {
      const history = createHistory<{ value: string }>();

      history.push({ value: 'first' });
      history.push({ value: 'second' });
      history.push({ value: 'third' });

      history.back();
      history.back();

      const result1 = history.forward();
      expect(result1).toEqual({ value: 'second' });

      const result2 = history.forward();
      expect(result2).toEqual({ value: 'third' });
    });
  });

  describe('canGoBack', () => {
    it('should return false for empty history', () => {
      const history = createHistory<{ value: string }>();
      expect(history.canGoBack()).toBe(false);
    });

    it('should return false when at first item', () => {
      const history = createHistory<{ value: string }>();
      history.push({ value: 'first' });
      expect(history.canGoBack()).toBe(false);
    });

    it('should return true when not at first item', () => {
      const history = createHistory<{ value: string }>();
      history.push({ value: 'first' });
      history.push({ value: 'second' });
      expect(history.canGoBack()).toBe(true);
    });
  });

  describe('canGoForward', () => {
    it('should return false for empty history', () => {
      const history = createHistory<{ value: string }>();
      expect(history.canGoForward()).toBe(false);
    });

    it('should return false when at last item', () => {
      const history = createHistory<{ value: string }>();
      history.push({ value: 'first' });
      history.push({ value: 'second' });
      expect(history.canGoForward()).toBe(false);
    });

    it('should return true when not at last item', () => {
      const history = createHistory<{ value: string }>();
      history.push({ value: 'first' });
      history.push({ value: 'second' });
      history.back();
      expect(history.canGoForward()).toBe(true);
    });
  });
});
