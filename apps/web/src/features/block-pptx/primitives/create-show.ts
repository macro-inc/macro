/**
 * The state of a running slide show, shared by the audience view and the
 * presenter console: the current slide, blacked or whitened screens, the
 * end-of-show screen, automatic advance, and PowerPoint's show keys.
 *
 * Next: click, Space, →, ↓, Enter, PageDown, N. Previous: ←, ↑, Backspace,
 * PageUp, P. Home/End jump; a number then Enter goes to that slide; B or .
 * blacks the screen, W or , whites it; Esc ends.
 */

import type { DeckOutline, SlideOutline } from '@core/pptx-engine/types';
import { createSignal, onCleanup } from 'solid-js';

export type ShowScreen = 'slide' | 'black' | 'white';

export function createShow(options: {
  deck: () => DeckOutline;
  start: number;
  onExit: (index: number) => void;
}) {
  const slides = () => options.deck().slides;
  const clamp = (i: number) => Math.min(Math.max(0, i), slides().length - 1);
  const [index, setIndex] = createSignal(clamp(options.start));
  const [screen, setScreen] = createSignal<ShowScreen>('slide');
  const [ended, setEnded] = createSignal(false);
  let typed = '';
  let advanceTimer: ReturnType<typeof setTimeout> | undefined;
  onCleanup(() => clearTimeout(advanceTimer));

  const slide = (): SlideOutline | undefined => slides()[index()];

  /** The next visible slide in a direction from `from`, if any. */
  const step = (direction: 1 | -1, from = index()): number | undefined => {
    for (
      let i = from + direction;
      i >= 0 && i < slides().length;
      i += direction
    )
      if (!slides()[i].hidden) return i;
    return undefined;
  };

  const go = (direction: 1 | -1) => {
    setScreen('slide');
    if (ended()) {
      if (direction < 0) setEnded(false);
      else exit();
      return;
    }
    const next = step(direction);
    if (next === undefined) {
      if (direction > 0) setEnded(true);
      return;
    }
    setIndex(next);
  };

  const jump = (i: number) => {
    setEnded(false);
    setScreen('slide');
    setIndex(clamp(i));
  };

  const exit = () => {
    clearTimeout(advanceTimer);
    options.onExit(index());
  };

  /** Call when slide `i` has appeared: starts its automatic advance. */
  const shown = (i: number) => {
    clearTimeout(advanceTimer);
    const after = slides()[i]?.transition?.advanceAfterMs;
    if (after !== undefined && after !== null)
      advanceTimer = setTimeout(() => go(1), after);
  };

  const toggleScreen = (which: 'black' | 'white') =>
    setScreen((s) => (s === which ? 'slide' : which));

  /** Handles a show key; true when it was one. */
  const onKey = (e: KeyboardEvent): boolean => {
    const key = e.key;
    if (/^\d$/.test(key)) {
      typed += key;
      return true;
    }
    if (key === 'Enter' && typed) {
      jump(Number(typed) - 1);
      typed = '';
      return true;
    }
    typed = '';
    switch (key) {
      case 'Escape':
      case '-':
        exit();
        return true;
      case ' ':
      case 'ArrowRight':
      case 'ArrowDown':
      case 'PageDown':
      case 'Enter':
      case 'n':
      case 'N':
        go(1);
        return true;
      case 'ArrowLeft':
      case 'ArrowUp':
      case 'PageUp':
      case 'Backspace':
      case 'p':
      case 'P':
        go(-1);
        return true;
      case 'Home':
        jump(0);
        return true;
      case 'End':
        jump(slides().length - 1);
        return true;
      case 'b':
      case 'B':
      case '.':
        toggleScreen('black');
        return true;
      case 'w':
      case 'W':
      case ',':
        toggleScreen('white');
        return true;
      default:
        return false;
    }
  };

  return {
    slides,
    index,
    slide,
    screen,
    ended,
    step,
    go,
    jump,
    exit,
    shown,
    toggleScreen,
    onKey,
  };
}

export type Show = ReturnType<typeof createShow>;
