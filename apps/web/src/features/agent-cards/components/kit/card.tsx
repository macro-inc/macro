import { Button, cn, Item, Card as UiCard } from '@ui';
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

/** How wide a card may grow: one item, an ask or list, or content to read. */
export type CardWidth = 'compact' | 'standard' | 'wide' | 'full';

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
  /** The whole column, as the agent question card is. */
  full: 'max-w-none',
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
 * The one shell every agent card uses: the app's `Card` from `@ui`, filled at
 * depth 3 as the routine and For you cards are. Compose the inside from its
 * parts: `Card.Header` with an `Item`, `CardBody`, `CardFooter`.
 *
 * A card with `onOpen` opens its item from anywhere on it: a button covers
 * the card, so it must hold no other controls.
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
    /** Names the card as a region, for a card that holds many things. */
    region?: string;
    /** The card's content is loading. */
    busy?: boolean;
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
      <UiCard
        variant="filled"
        depth={3}
        role={props.region ? 'region' : undefined}
        aria-label={props.region}
        aria-busy={props.busy || undefined}
        data-agent-card={props['data-agent-card'] ?? ''}
        class={cn(
          'group/card w-full overflow-hidden',
          'transition-[opacity,translate,border-color] duration-300 ease-out starting:translate-y-1 starting:opacity-0',
          WIDTHS[props.width ?? 'compact'],
          props.selected &&
            'border-accent/40 shadow-[0_0_0_3px_var(--color-accent-bg)]',
          props.muted && 'opacity-70',
          props.class
        )}
        style={fixed() ? { height: `${props.height}px` } : undefined}
      >
        {props.children}
        <Show when={props.onOpen}>
          {(open) => (
            <button
              type="button"
              aria-label={props.label}
              class="absolute inset-0 rounded-[inherit] outline-none not-touch:hover:bg-hover focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent"
              onClick={(event) => open()(event)}
            />
          )}
        </Show>
      </UiCard>
    </CardContext.Provider>
  );
}

/**
 * A card's body, `Card.Body` under its header. Under a fixed height it fills
 * the space between the header and the footer and clips under a fade; rows
 * marked `data-card-row` that fall below it are counted for the footer. A
 * live log anchors to the bottom instead, so its newest row stays in view and
 * the fade sits on top.
 */
export function CardBody(
  props: ParentProps<{
    /** Rows that bring their own padding: the body only insets them. */
    tight?: boolean;
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
    <UiCard.Body
      ref={body}
      class={cn(
        'relative flex min-h-0 flex-col pt-0',
        props.tight ? 'gap-0.5 px-1 pb-2' : 'gap-2',
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
    </UiCard.Body>
  );
}

/**
 * A card's footer, `Card.Footer`: `Card.Metadata` on the left, actions on the
 * right. Its hairline shows when the card holds a fixed height, so it reads
 * as pinned, or when `line` asks for it.
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
    <UiCard.Footer
      class={cn(
        'mt-auto flex-none',
        props.small && 'py-2',
        !(props.line || card?.fixed()) && 'border-t-0 pt-0',
        props.class
      )}
    >
      {props.children}
    </UiCard.Footer>
  );
}

/**
 * What a fixed card is hiding, and the way to see it: "4 more below" with
 * "Show all 9", which grows the card in place. The count of everything while
 * everything fits.
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
        <UiCard.Metadata>
          {props.total} {props.noun ?? (props.total === 1 ? 'item' : 'items')}
        </UiCard.Metadata>
      }
    >
      <UiCard.Metadata>{hidden()} more below</UiCard.Metadata>
      <Button
        size="sm"
        variant="ghost"
        class="touch:min-h-11"
        onClick={(event: MouseEvent) => {
          event.stopPropagation();
          card?.expand();
        }}
      >
        Show all {props.total}
      </Button>
    </Show>
  );
}

/**
 * A card that is one row, `Card.Header` holding an `Item`: the media that
 * says what it is, its title, a line about it, and whatever trails it - an
 * arrow for a link.
 */
export function CardSingle(props: {
  media: JSX.Element;
  title: JSX.Element;
  description?: JSX.Element;
  trailing?: JSX.Element;
  /** Strike the title: the item is gone. */
  struck?: boolean;
}) {
  return (
    <UiCard.Header class="flex-1 justify-center">
      <Item class="gap-3 border-0 p-0">
        {props.media}
        <Item.Content class="gap-0">
          <UiCard.Title class={cn('truncate', props.struck && 'line-through')}>
            {props.title}
          </UiCard.Title>
          <Show when={props.description}>
            <UiCard.Description class="truncate">
              {props.description}
            </UiCard.Description>
          </Show>
        </Item.Content>
        <Show when={props.trailing}>
          <Item.Actions>{props.trailing}</Item.Actions>
        </Show>
      </Item>
    </UiCard.Header>
  );
}
