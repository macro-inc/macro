import { createEffect, createSignal, on, onCleanup } from 'solid-js';
import { createStore } from 'solid-js/store';

type TranscriptScrollState = { following: boolean; activeVisible: boolean };
type TranscriptScrollOptions = {
  active?: boolean;
  activeSequenceNum?: number | null;
  scrollElement?: HTMLElement;
  videoSeekGeneration?: number;
  manualScrollGeneration?: number;
};

/** Own transcript follow, manual scroll intent and active-row visibility. */
export function createTranscriptScroll(options: TranscriptScrollOptions) {
  const [scrollRef, setScrollRef] = createSignal<HTMLElement>();
  const viewport = () =>
    options.active === false
      ? undefined
      : (options.scrollElement ?? scrollRef());
  const [state, setState] = createStore<TranscriptScrollState>({
    following: true,
    activeVisible: true,
  });
  const following = () => state.following;
  const activeVisible = () => state.activeVisible;
  const setFollowing = (value: boolean) => setState('following', value);
  const setActiveVisible = (value: boolean) => setState('activeVisible', value);
  const rows = new Map<number, HTMLDivElement>();
  let ignoreScrollUntil = 0;
  const updateVisibility = () => {
    const sequence = options.activeSequenceNum;
    if (sequence === null || sequence === undefined) {
      setActiveVisible(true);
      return;
    }
    const container = viewport();
    const row = rows.get(sequence);
    if (!container || !row) {
      setActiveVisible(false);
      return;
    }
    const outer = container.getBoundingClientRect();
    const inner = row.getBoundingClientRect();
    setActiveVisible(inner.bottom > outer.top && inner.top < outer.bottom);
  };

  const scrollActiveIntoView = (
    force = false,
    behavior: ScrollBehavior = 'smooth'
  ) => {
    const sequence = options.activeSequenceNum;
    if (sequence === null || sequence === undefined) return;
    const container = viewport();
    const row = rows.get(sequence);
    if (!container || !row) return;
    const outer = container.getBoundingClientRect();
    const inner = row.getBoundingClientRect();
    if (!force && inner.top >= outer.top && inner.bottom <= outer.bottom)
      return;
    ignoreScrollUntil = performance.now() + 350;
    container.scrollTo({
      top: Math.max(
        0,
        container.scrollTop +
          inner.top -
          outer.top -
          container.clientHeight / 2 +
          row.clientHeight / 2
      ),
      behavior,
    });
  };

  createEffect(
    on(
      () => options.videoSeekGeneration ?? 0,
      (generation, previous) => {
        if (previous !== undefined && generation !== previous) {
          setFollowing(true);
          scrollActiveIntoView(true);
        }
        updateVisibility();
      }
    )
  );

  createEffect(
    on(
      () => [options.activeSequenceNum, following(), viewport()] as const,
      () => {
        if (following()) scrollActiveIntoView();
        updateVisibility();
      }
    )
  );

  createEffect(
    on(
      () => options.manualScrollGeneration ?? 0,
      (generation, previous) => {
        if (previous !== undefined && generation !== previous)
          setFollowing(false);
      }
    )
  );

  createEffect(() => {
    const element = viewport();
    if (!element) return;
    const stopFollowing = () => setFollowing(false);
    const onScroll = () => {
      if (!following() || performance.now() >= ignoreScrollUntil)
        updateVisibility();
    };
    const onPointerDown = (event: PointerEvent) => {
      // Scrollbar presses target the viewport; content presses target a row.
      if (event.target === element && event.pointerType !== 'touch')
        stopFollowing();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (
        [
          'ArrowUp',
          'ArrowDown',
          'PageUp',
          'PageDown',
          'Home',
          'End',
          ' ',
        ].includes(event.key)
      )
        stopFollowing();
    };
    element.addEventListener('wheel', stopFollowing, { passive: true });
    element.addEventListener('touchmove', stopFollowing, { passive: true });
    element.addEventListener('scroll', onScroll, { passive: true });
    element.addEventListener('pointerdown', onPointerDown);
    element.addEventListener('keydown', onKeyDown);
    const observer = new ResizeObserver(() => {
      if (following()) scrollActiveIntoView(false, 'auto');
      updateVisibility();
    });
    observer.observe(element);
    onCleanup(() => {
      observer.disconnect();
      element.removeEventListener('wheel', stopFollowing);
      element.removeEventListener('touchmove', stopFollowing);
      element.removeEventListener('scroll', onScroll);
      element.removeEventListener('pointerdown', onPointerDown);
      element.removeEventListener('keydown', onKeyDown);
    });
  });
  return {
    scrollRef,
    setScrollRef,
    following,
    activeVisible,
    stopFollowing: () => setFollowing(false),
    sync: () => {
      setFollowing(true);
      scrollActiveIntoView(true);
    },
    registerRow: (sequence: number, element: HTMLDivElement) => {
      rows.set(sequence, element);
      onCleanup(() => rows.delete(sequence));
    },
  };
}
export type TranscriptScroll = ReturnType<typeof createTranscriptScroll>;
