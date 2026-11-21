import { t } from '@app/lib/i18n';
import { createElementSize } from '@solid-primitives/resize-observer';
import { Button } from '@ui';
import { type Accessor, For, type JSX, onCleanup, Show } from 'solid-js';
import { createStore } from 'solid-js/store';

/** How far each older call peeks out below the one above it. */
const PEEK_PX = 10;
/** The space between calls once the stack is fanned out (Tailwind `gap-3`). */
const GAP_PX = 12;
/** How much smaller each older sheet is than the one in front of it. */
const DEPTH_SCALE = 0.045;
/** Sheets that peek out under the newest call; older ones hide behind them. */
const MAX_PEEK_DEPTH = 2;
const PEEK_OPACITY = [1, 0.9, 0.7];

/**
 * Ringing calls stacked like notifications: the newest in front, older ones
 * peeking out underneath. Clicking the stack fans every call out below it;
 * Show less folds it back. Each call keeps its place in the DOM either way,
 * so a call's card never remounts as the stack opens or closes.
 */
export function IncomingCallStack(props: {
  /** One key per ringing call, newest first. */
  keys: string[];
  expanded: boolean;
  onExpand: () => void;
  onCollapse: () => void;
  /** A call's card; `concealed` while it is tucked under the newest call. */
  children: (key: string, concealed: Accessor<boolean>) => JSX.Element;
}) {
  const [cards, setCards] = createStore<
    Record<string, HTMLDivElement | undefined>
  >({});
  const count = () => props.keys.length;
  const stacked = () => !props.expanded && count() > 1;
  // Every card has the same layout at one width, so the newest one's height
  // places the rest.
  const newest = createElementSize(() => cards[props.keys[0] ?? '']);
  const cardHeight = () => newest.height ?? 0;

  const listHeight = () => {
    const height = cardHeight();
    if (!height) return undefined;
    const n = count();
    return stacked()
      ? height + Math.min(n - 1, MAX_PEEK_DEPTH) * PEEK_PX
      : n * height + (n - 1) * GAP_PX;
  };

  const itemStyle = (index: number): JSX.CSSProperties => {
    if (!stacked()) return { 'z-index': count() - index };
    const height = cardHeight();
    const depth = Math.min(index, MAX_PEEK_DEPTH);
    // Until the newest card is measured, show only it rather than guess.
    const opacity =
      index > MAX_PEEK_DEPTH || (!height && index > 0)
        ? 0
        : PEEK_OPACITY[depth];
    const offset = -index * (height + GAP_PX) + depth * PEEK_PX;
    return {
      'z-index': count() - index,
      opacity,
      transform: `translateY(${offset}px) scale(${1 - depth * DEPTH_SCALE})`,
    };
  };

  const expandFromClick = (event: MouseEvent) => {
    if (!stacked()) return;
    // Join and Decline answer the newest call; only the rest of it opens the stack.
    if ((event.target as Element | null)?.closest('button')) return;
    props.onExpand();
  };

  return (
    <div class="flex flex-col">
      <Show when={props.expanded && count() > 1}>
        <div class="pointer-events-auto mb-2 flex items-center justify-between gap-2">
          <span class="rounded-full px-3 py-1.5 text-sm font-semibold text-ink-muted menu-surface">
            {t('calls.incomingCallCount', { count: count() })}
          </span>
          <Button variant="secondary" size="sm" onClick={props.onCollapse}>
            {t('calls.showFewerIncomingCalls')}
          </Button>
        </div>
      </Show>
      <div
        class="relative flex flex-col gap-3 transition-[height] duration-300 ease-out motion-reduce:transition-none"
        style={{
          height: listHeight() === undefined ? undefined : `${listHeight()}px`,
        }}
        onClick={expandFromClick}
      >
        <For each={props.keys}>
          {(key, index) => {
            onCleanup(() => setCards(key, undefined));
            return (
              <div
                ref={(element) => setCards(key, element)}
                class="origin-bottom transition-[transform,opacity] duration-300 ease-out motion-reduce:transition-none"
                style={itemStyle(index())}
              >
                {props.children(key, () => stacked() && index() > 0)}
              </div>
            );
          }}
        </For>
        <Show when={stacked()}>
          <button
            type="button"
            aria-label={t('calls.showAllIncomingCalls', { count: count() })}
            class="pointer-events-auto absolute inset-x-4 bottom-0 rounded-b-2xl focus-visible:outline-2 focus-visible:outline-accent"
            style={{
              'z-index': count() + 1,
              height: `${Math.min(count() - 1, MAX_PEEK_DEPTH) * PEEK_PX + 4}px`,
            }}
            onClick={props.onExpand}
          />
        </Show>
      </div>
    </div>
  );
}
