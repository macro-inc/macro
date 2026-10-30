import { createResizeObserver } from '@solid-primitives/resize-observer';
import {
  createEffect,
  createSignal,
  createUniqueId,
  For,
  type JSX,
  on,
  onCleanup,
  onMount,
  Show,
  untrack,
} from 'solid-js';
import { Button } from './Button';

const GAP = 8;
const PEEK = 9;
const EXIT_DURATION = 250;

type StackEntry<T> = {
  key: string;
  item: () => T;
  setItem: (item: T) => void;
  leaving: () => boolean;
  setLeaving: (leaving: boolean) => void;
};

export type NotificationStackProps<T> = {
  /** Accessible name for the stack region. */
  label: string;
  /** Header content shown above the stack, e.g. a count of pending items. */
  title: JSX.Element;
  items: readonly T[];
  /** Stable identity; keys the card across reorders and removals. */
  itemKey: (item: T) => string;
  /**
   * Renders one card's content, once per key like `For`. The stack draws the
   * card surface; read live data inside the card, not from a new item object.
   */
  children: (item: T) => JSX.Element;
  /** Controlled disclosure state. A stack with fewer than two items always closes. */
  expanded?: boolean;
  onExpandedChange?: (expanded: boolean) => void;
};

/**
 * Cards that rest as a stack, the newest in front, and unstack into a list.
 * @do Use for a short queue of independent items that each need attention.
 * @do Keep each card self-contained: its actions act on that item only.
 */
export function NotificationStack<T>(props: NotificationStackProps<T>) {
  const cardsId = createUniqueId();
  const [localExpanded, setLocalExpanded] = createSignal(false);
  const [entries, setEntries] = createSignal<StackEntry<T>[]>([]);
  const [heights, setHeights] = createSignal<Record<string, number>>({});
  const exitTimers = new Map<string, ReturnType<typeof setTimeout>>();
  const expanded = () =>
    props.items.length > 1 && (props.expanded ?? localExpanded());
  const heightOf = (entry: StackEntry<T>) => heights()[entry.key] ?? 2;
  const frontHeight = () => (entries()[0] ? heightOf(entries()[0]) : 0);
  const cardTop = (index: number) =>
    expanded()
      ? entries()
          .slice(0, index)
          .reduce((top, entry) => top + heightOf(entry) + GAP, 0)
      : Math.min(index, 2) * PEEK;
  const stackHeight = () =>
    expanded()
      ? entries().reduce(
          (height, entry) => height + heightOf(entry) + GAP,
          -GAP
        )
      : frontHeight() + Math.min(entries().length - 1, 2) * PEEK;

  const setExpanded = (value: boolean) => {
    if (props.expanded === undefined) setLocalExpanded(value);
    props.onExpandedChange?.(value);
  };

  // Presence is stateful so a removed card can finish its exit before the gap closes.
  createEffect(
    on(
      () => props.items,
      (items) => {
        const previous = entries();
        const byKey = new Map(previous.map((entry) => [entry.key, entry]));
        const next = items.map((item) => {
          const key = props.itemKey(item);
          const existing = byKey.get(key);
          if (existing) {
            const timer = exitTimers.get(key);
            if (timer) clearTimeout(timer);
            exitTimers.delete(key);
            existing.setItem(item);
            existing.setLeaving(false);
            return existing;
          }
          const [currentItem, setItem] = createSignal(item);
          const [leaving, setLeaving] = createSignal(false);
          return { key, item: currentItem, setItem, leaving, setLeaving };
        });
        const currentKeys = new Set(items.map(props.itemKey));
        for (const [index, entry] of previous.entries()) {
          if (currentKeys.has(entry.key)) continue;
          if (!entry.leaving()) {
            entry.setLeaving(true);
            if (
              typeof window !== 'undefined' &&
              window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
            )
              continue;
            const timer = setTimeout(() => {
              exitTimers.delete(entry.key);
              setEntries((current) => current.filter((card) => card !== entry));
            }, EXIT_DURATION);
            exitTimers.set(entry.key, timer);
          }
          if (exitTimers.has(entry.key))
            next.splice(Math.min(index, next.length), 0, entry);
        }
        setEntries(next);
        if (items.length < 2 && (props.expanded ?? localExpanded()))
          setExpanded(false);
      }
    )
  );
  onCleanup(() => {
    for (const timer of exitTimers.values()) clearTimeout(timer);
  });

  const measure = (key: string, element: HTMLElement) => {
    const height = element.getBoundingClientRect().height + 2;
    setHeights((current) =>
      current[key] === height ? current : { ...current, [key]: height }
    );
  };

  return (
    <Show when={props.items.length > 0}>
      <section aria-label={props.label} class="flex flex-col gap-2">
        <div class="flex min-h-7 items-center gap-2 px-2 text-sm">
          {props.title}
          <Show when={props.items.length > 1}>
            <Button
              size="sm"
              variant="ghost"
              class="ml-auto"
              aria-expanded={expanded()}
              aria-controls={cardsId}
              onClick={() => setExpanded(!expanded())}
            >
              {expanded() ? 'Show less' : 'Show all'}
            </Button>
          </Show>
        </div>
        <div
          id={cardsId}
          class="relative motion-safe:transition-[height] motion-safe:duration-[420ms] motion-safe:ease-[cubic-bezier(0.22,1,0.36,1)]"
          style={{ height: `${Math.max(0, stackHeight())}px` }}
          onClick={(event) => {
            if (expanded() || props.items.length < 2) return;
            if (
              event.target instanceof Element &&
              event.target.closest(
                'button, a, input, textarea, select, [role="button"]'
              )
            )
              return;
            setExpanded(true);
          }}
        >
          <For each={entries()}>
            {(entry, index) => {
              let content: HTMLDivElement | undefined;
              const [entering, setEntering] = createSignal(true);
              const behind = () => !expanded() && index() > 0;
              const hidden = () => entry.leaving() || behind();
              const cardHeight = () =>
                expanded() ? heightOf(entry) : frontHeight();
              createResizeObserver(
                () => content,
                (_rect, element) => measure(entry.key, element)
              );
              onMount(() => {
                if (content) measure(entry.key, content);
                const frame = requestAnimationFrame(() => setEntering(false));
                onCleanup(() => cancelAnimationFrame(frame));
              });
              return (
                <article
                  data-notification-key={entry.key}
                  aria-hidden={hidden()}
                  inert={hidden()}
                  class="absolute inset-x-0 top-0 box-border overflow-hidden rounded-2xl border border-edge-frame shadow-sm origin-top motion-safe:transition-[top,height,transform,opacity,background-color,box-shadow] motion-safe:[transition-duration:420ms,420ms,420ms,250ms,200ms,200ms] motion-safe:ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none"
                  classList={{
                    'bg-panel': !behind(),
                    'bg-surface': behind(),
                    'pointer-events-none': hidden(),
                    'not-touch:hover:shadow-md': !expanded() && index() === 0,
                  }}
                  style={{
                    top: `${cardTop(index())}px`,
                    height: `${cardHeight()}px`,
                    transform:
                      entry.leaving() || entering()
                        ? 'scale(0.96)'
                        : expanded()
                          ? 'scale(1)'
                          : `scale(${1 - Math.min(index(), 2) * 0.045})`,
                    opacity:
                      entry.leaving() || entering() || (behind() && index() > 2)
                        ? 0
                        : 1,
                    'z-index': entries().length - index(),
                    'transition-delay':
                      expanded() && !entry.leaving()
                        ? `${index() * 30}ms`
                        : '0ms',
                  }}
                >
                  <div
                    ref={content}
                    class="flow-root motion-safe:transition-opacity motion-safe:duration-200 motion-reduce:transition-none"
                    classList={{ 'opacity-0': behind() }}
                  >
                    {untrack(() => props.children(entry.item()))}
                  </div>
                </article>
              );
            }}
          </For>
        </div>
      </section>
    </Show>
  );
}
