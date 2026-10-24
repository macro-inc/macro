import { cn } from '@ui';
import {
  createContext,
  createSignal,
  type JSX,
  onCleanup,
  onMount,
  type ParentProps,
  Show,
  useContext,
} from 'solid-js';
import { Dynamic } from 'solid-js/web';

/** How wide a card may grow: one item, an ask or list, or content to read. */
export type CardWidth = 'compact' | 'standard' | 'wide';

/**
 * How tall a card is. `auto` grows with its content; a fixed height is both a
 * ceiling and a floor - the header and footer pin, the body clips under a
 * fade, and the footer says what is hidden.
 */
export type CardHeight = 'auto' | 72 | 160 | 240 | 320;

const WIDTHS: Record<CardWidth, string> = {
  compact: 'max-w-md',
  standard: 'max-w-xl',
  wide: 'max-w-2xl',
};

type CardState = {
  /** The card holds a fixed height right now. */
  fixed: () => boolean;
  /** Rows of the body that sit below the visible area. */
  hidden: () => number;
  setHidden: (count: number) => void;
  /** Show the whole card, dropping the fixed height. */
  expand: () => void;
  expanded: () => boolean;
};

const CardContext = createContext<CardState>();

/** The state of the card a slot sits in. */
function useCard(): CardState | undefined {
  return useContext(CardContext);
}

/**
 * The one shell every agent card uses: a 12px-radius panel with a hairline
 * edge and no shadow, holding a header, a body and a footer. In dark themes
 * the hairline is the card's only edge, so it is never dropped.
 *
 * A card with `onOpen` is a link to its item: the whole card opens it.
 */
export function Card(
  props: ParentProps<{
    width?: CardWidth;
    height?: CardHeight;
    /** The item is out of reach: no access, or gone. */
    muted?: boolean;
    /** Focused or chosen. */
    selected?: boolean;
    /** Opens what the card is about. */
    onOpen?: (event: MouseEvent) => void;
    /** Read aloud for a card that opens something. */
    label?: string;
    class?: string;
    'data-agent-card'?: string;
  }>
) {
  const [hidden, setHidden] = createSignal(0);
  const [expanded, setExpanded] = createSignal(false);
  const fixed = () =>
    props.height !== undefined && props.height !== 'auto' && !expanded();
  const state: CardState = {
    fixed,
    hidden,
    setHidden,
    expand: () => setExpanded(true),
    expanded,
  };
  return (
    <CardContext.Provider value={state}>
      <Dynamic
        component={props.onOpen ? 'button' : 'div'}
        type={props.onOpen ? 'button' : undefined}
        aria-label={props.onOpen ? props.label : undefined}
        onClick={(event: MouseEvent) => props.onOpen?.(event)}
        data-agent-card={props['data-agent-card'] ?? ''}
        class={cn(
          'group/card flex w-full min-w-0 flex-col overflow-hidden rounded-xl border border-edge-muted bg-panel text-left text-ink',
          'transition-[opacity,translate,background-color,border-color] duration-300 ease-out starting:translate-y-1 starting:opacity-0',
          WIDTHS[props.width ?? 'compact'],
          props.onOpen &&
            'not-touch:hover:border-edge not-touch:hover:bg-hover',
          props.selected &&
            'border-accent/40 shadow-[0_0_0_3px_var(--color-accent-bg)]',
          props.muted && 'opacity-70',
          props.class
        )}
        style={fixed() ? { height: `${props.height}px` } : undefined}
      >
        {props.children}
      </Dynamic>
    </CardContext.Provider>
  );
}

/**
 * A card's header: a tile that says what it is about, a title, a subtitle,
 * and anything trailing - a status pill or a menu.
 */
export function CardHeader(props: {
  tile?: JSX.Element;
  title: JSX.Element;
  /** What happened to the item, beside its title: `Created`. */
  badge?: JSX.Element;
  subtitle?: JSX.Element;
  trailing?: JSX.Element;
  /** Center the tile on the text instead of aligning to the top. */
  center?: boolean;
  /** The header is the whole card, or sits above a hairline. */
  padded?: boolean;
  /** Let a long title wrap rather than truncate. */
  wrap?: boolean;
}) {
  return (
    <div
      class={cn(
        'flex flex-none gap-2.5 px-3 pt-3',
        props.center ? 'items-center' : 'items-start',
        props.padded && 'pb-3'
      )}
    >
      {props.tile}
      <div class="flex min-w-0 flex-1 flex-col">
        <span class="flex min-w-0 items-center gap-1.5">
          <span
            class={cn(
              'text-sm font-medium text-ink',
              props.wrap ? '[overflow-wrap:anywhere]' : 'truncate'
            )}
          >
            {props.title}
          </span>
          {props.badge}
        </span>
        <Show when={props.subtitle}>
          <span class="truncate text-xs leading-5 text-ink-muted">
            {props.subtitle}
          </span>
        </Show>
      </div>
      {props.trailing}
    </div>
  );
}

/**
 * A card's body. Under a fixed height it fills the space between the header
 * and the footer and clips under a fade; rows marked `data-card-row` that
 * fall below it are counted for the footer. A live log anchors to the
 * bottom instead, so its newest row stays in view and the fade sits on top.
 */
export function CardBody(
  props: ParentProps<{
    /** Tight padding for lists of rows. */
    tight?: boolean;
    /** No padding: the content brings its own. */
    flush?: boolean;
    /** Keep the newest content in view: the fade moves to the top. */
    anchor?: 'top' | 'bottom';
    class?: string;
  }>
) {
  const card = useCard();
  let body: HTMLDivElement | undefined;
  const measure = () => {
    if (!body || !card) return;
    if (!card.fixed()) {
      card.setHidden(0);
      return;
    }
    if (props.anchor === 'bottom') body.scrollTop = body.scrollHeight;
    const limit = body.scrollTop + body.clientHeight - 12;
    let hidden = 0;
    for (const row of body.querySelectorAll<HTMLElement>('[data-card-row]')) {
      if (row.offsetTop + row.offsetHeight > limit) hidden += 1;
    }
    card.setHidden(props.anchor === 'bottom' ? 0 : hidden);
  };
  onMount(() => {
    if (!body) return;
    measure();
    // Without layout observers (a test DOM), one measurement is all there is.
    if (typeof ResizeObserver === 'undefined') return;
    const resize = new ResizeObserver(measure);
    resize.observe(body);
    const mutations = new MutationObserver(measure);
    mutations.observe(body, { childList: true, subtree: true });
    onCleanup(() => {
      resize.disconnect();
      mutations.disconnect();
    });
  });
  return (
    <div
      ref={body}
      class={cn(
        'relative flex min-h-0 min-w-0 flex-col',
        props.flush
          ? 'gap-0 p-0'
          : props.tight
            ? 'gap-0.5 px-1.5 py-2'
            : 'gap-2 p-3',
        card?.fixed() &&
          cn(
            'flex-1 overflow-hidden',
            // The fade a fixed body clips under: the cue that more is hidden.
            props.anchor === 'bottom'
              ? '[mask-image:linear-gradient(to_top,#000_calc(100%-36px),transparent)]'
              : '[mask-image:linear-gradient(to_bottom,#000_calc(100%-36px),transparent)]'
          ),
        props.class
      )}
    >
      {props.children}
    </div>
  );
}

/**
 * A card's footer: actions on the right, the primary last, a dismissal
 * pushed to the far left with `mr-auto`. It pins with a hairline above it
 * when the card has a fixed height.
 */
export function CardFooter(
  props: ParentProps<{
    small?: boolean;
    /** Draw the hairline even when the card grows with its content. */
    line?: boolean;
    class?: string;
  }>
) {
  const card = useCard();
  return (
    <div
      class={cn(
        'mt-auto flex flex-none flex-wrap items-center gap-2',
        props.small ? 'px-3 py-2' : 'p-3',
        (props.line || card?.fixed()) && 'border-t border-edge-muted',
        props.class
      )}
    >
      {props.children}
    </div>
  );
}

/**
 * What a fixed card is hiding, and the way to see it: "4 more below" with
 * "Show all 9", which grows the card in place. Nothing while everything
 * fits.
 */
export function CardHiddenCount(props: {
  /** Everything the body holds, for "Show all N". */
  total: number;
  /** What the rows are, for the count: `files`, `events`. */
  noun?: string;
}) {
  const card = useCard();
  const hidden = () => card?.hidden() ?? 0;
  return (
    <Show
      when={hidden() > 0}
      fallback={
        <span class="mr-auto text-xs text-ink-subtle">
          {props.total} {props.noun ?? (props.total === 1 ? 'item' : 'items')}
        </span>
      }
    >
      <span class="mr-auto text-xs text-ink-subtle">{hidden()} more below</span>
      <button
        type="button"
        class="text-xs font-medium text-ink-muted hover:text-ink"
        onClick={(event) => {
          event.stopPropagation();
          card?.expand();
        }}
      >
        Show all {props.total}
      </button>
    </Show>
  );
}

/**
 * A card that is one row: an item named by its tile, title and a line about
 * it, with whatever trails it - an arrow for a link, a button.
 */
export function CardSingle(
  props: ParentProps<{
    tile?: JSX.Element;
    title: JSX.Element;
    badge?: JSX.Element;
    meta?: JSX.Element;
    trailing?: JSX.Element;
    /** Strike the title: the item is gone. */
    struck?: boolean;
  }>
) {
  return (
    <div class="flex min-w-0 flex-1 items-center gap-3 px-3 py-2.5">
      {props.tile}
      <span class="flex min-w-0 flex-1 flex-col">
        <span class="flex min-w-0 items-center gap-1.5">
          <span
            class={cn(
              'truncate text-sm font-medium text-ink',
              props.struck && 'line-through'
            )}
          >
            {props.title}
          </span>
          {props.badge}
        </span>
        <Show when={props.meta}>
          <span class="truncate text-xs text-ink-muted">{props.meta}</span>
        </Show>
        {props.children}
      </span>
      {props.trailing}
    </div>
  );
}
