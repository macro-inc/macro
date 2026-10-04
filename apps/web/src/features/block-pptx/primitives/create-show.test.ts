import type { DeckOutline } from '@core/pptx-engine/types';
import { createRoot } from 'solid-js';
import { describe, expect, it, vi } from 'vitest';
import { formatElapsed } from '../components/presenter-view';
import { createShow } from './create-show';

const deck = (hidden: boolean[]): DeckOutline =>
  ({
    width: 960,
    height: 540,
    slides: hidden.map((h, index) => ({
      id: 256 + index,
      index,
      layout: 'Blank',
      hidden: h,
      shapes: [],
    })),
    layouts: [],
    themeColors: [],
    tableStyles: [],
  }) as DeckOutline;

const key = (k: string) => new KeyboardEvent('keydown', { key: k });

describe('slide show', () => {
  it('skips hidden slides, ends, and exits past the end', () => {
    const onExit = vi.fn();
    createRoot((dispose) => {
      const show = createShow({
        deck: () => deck([false, true, false]),
        start: 0,
        onExit,
      });
      show.go(1);
      expect(show.index()).toBe(2);
      show.go(1);
      expect(show.ended()).toBe(true);
      show.go(-1);
      expect(show.ended()).toBe(false);
      show.go(1);
      show.go(1);
      expect(onExit).toHaveBeenCalledWith(2);
      dispose();
    });
  });

  it('jumps to a typed slide number and toggles black and white', () => {
    createRoot((dispose) => {
      const show = createShow({
        deck: () => deck([false, false, false, false]),
        start: 0,
        onExit: () => {},
      });
      expect(show.onKey(key('3'))).toBe(true);
      show.onKey(key('Enter'));
      expect(show.index()).toBe(2);
      show.onKey(key('b'));
      expect(show.screen()).toBe('black');
      show.onKey(key('w'));
      expect(show.screen()).toBe('white');
      show.onKey(key('ArrowLeft'));
      expect(show.screen()).toBe('slide');
      expect(show.index()).toBe(1);
      expect(show.onKey(key('x'))).toBe(false);
      dispose();
    });
  });

  it('formats the presenter timer', () => {
    expect(formatElapsed(65_000)).toBe('01:05');
    expect(formatElapsed(3_725_000)).toBe('1:02:05');
  });
});
