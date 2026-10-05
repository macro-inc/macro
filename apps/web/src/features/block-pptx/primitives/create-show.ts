/**
 * The state of a running slide show, shared by the audience view and the
 * presenter console: the current slide, blacked or whitened screens, the
 * end-of-show screen, automatic advance, and PowerPoint's show keys.
 *
 * Each click first plays the slide's next animation step, then moves on;
 * going back steps back through them.
 *
 * Next: click, Space, →, ↓, Enter, PageDown, N. Previous: ←, ↑, Backspace,
 * PageUp, P. Home/End jump; a number then Enter goes to that slide; B or .
 * blacks the screen, W or , whites it; Esc ends. Clicking a link follows it
 * (`follow`).
 */

import type { DeckOutline, SlideOutline } from '@core/pptx-engine/types';
import { createSignal, onCleanup } from 'solid-js';
import { buildTimeline, clickSteps } from '../core/animation-timeline';
import { linkAction } from '../core/links';

export type ShowScreen = 'slide' | 'black' | 'white';

export function createShow(options: {
  deck: () => DeckOutline;
  start: number;
  onExit: (index: number) => void;
}) {
  const slides = () => options.deck().slides;
  const clamp = (i: number) => Math.min(Math.max(0, i), slides().length - 1);
  const [index, setIndex] = createSignal(clamp(options.start));
  /** Click steps played on the current slide. */
  const [step, setStep] = createSignal(0);
  /** Click steps a slide takes. */
  const stepsOf = (i: number) => {
    const slide = slides()[i];
    return slide?.animations?.length ? clickSteps(buildTimeline(slide)) : 0;
  };
  const [screen, setScreen] = createSignal<ShowScreen>('slide');
  const [ended, setEnded] = createSignal(false);
  let typed = '';
  let advanceTimer: ReturnType<typeof setTimeout> | undefined;
  onCleanup(() => clearTimeout(advanceTimer));

  const slide = (): SlideOutline | undefined => slides()[index()];
  /** The slide shown before the current one (Last Slide Viewed links). */
  let lastViewed: number | undefined;
  const moveTo = (i: number) => {
    if (i !== index()) lastViewed = index();
    setIndex(i);
  };

  /** The next visible slide in a direction from `from`, if any. */
  const nextSlide = (direction: 1 | -1, from = index()): number | undefined => {
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
    if (direction > 0 && step() < stepsOf(index())) {
      setStep(step() + 1);
      return;
    }
    if (direction < 0 && step() > 0) {
      setStep(step() - 1);
      return;
    }
    const next = nextSlide(direction);
    if (next === undefined) {
      if (direction > 0) setEnded(true);
      return;
    }
    // Going back lands on a slide with all its animations played.
    setStep(direction > 0 ? 0 : stepsOf(next));
    moveTo(next);
  };

  const jump = (i: number) => {
    setEnded(false);
    setScreen('slide');
    setStep(0);
    moveTo(clamp(i));
  };

  /**
   * Follows a link clicked in the show: goes to a slide or ends the show.
   * Returns the web address to open for an address link.
   */
  const follow = (link: string): string | undefined => {
    if (link === '#nextslide' || link === '#previousslide') {
      const to = nextSlide(link === '#nextslide' ? 1 : -1);
      if (to !== undefined) jump(to);
      else if (link === '#nextslide') setEnded(true);
      return undefined;
    }
    const action = linkAction(link, options.deck(), index(), lastViewed);
    if (action.kind === 'slide') jump(action.index);
    else if (action.kind === 'end') exit();
    return action.kind === 'open' ? action.url : undefined;
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
    /** Click steps played on the current slide. */
    step,
    /** The next visible slide in a direction, if any. */
    nextSlide,
    go,
    jump,
    follow,
    exit,
    shown,
    toggleScreen,
    onKey,
  };
}

export type Show = ReturnType<typeof createShow>;
