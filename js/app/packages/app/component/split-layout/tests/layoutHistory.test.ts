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
