import { cn } from '@ui';
import type { JSX } from 'solid-js';
import {
  createEffect,
  createMemo,
  createSignal,
  For,
  Match,
  on,
  onCleanup,
  onMount,
  Switch,
} from 'solid-js';
import { type VirtualizerHandle, VList } from 'virtua/solid';
import { emojiRows } from './emoji-rows';
import { type SimpleEmoji, useEmojiData } from './emojis';
import { recordEmojiUsage } from './emojiUsage';

function renderEmoji(emoji: string, size: string): JSX.Element {
  return (
    <p
      class={`emoji flex items-center justify-center`}
      style={{
        width: size,
        height: size,
        'font-size': size,
      }}
    >
      {emoji}
    </p>
  );
}

interface EmojiPickerProps {
  nameFilter?: string;
  onEmojiClick: (emoji: SimpleEmoji) => void;
  columns?: number;
  /** Restrict picker keyboard handling to its search/grid region when embedded. */
  keyboardScope?: HTMLElement;
}

interface EmojiOptionProps {
  emoji: SimpleEmoji;
  onEmojiClick: (emoji: SimpleEmoji) => void;
  isSelected: boolean;
  /** A length against the row's query container, from `emojiSize` below. */
  size: string;
}

function EmojiOption(props: EmojiOptionProps): JSX.Element {
  return (
    <button
      type="button"
      class={cn(
        'hover:bg-hover hover-transition-bg rounded-md p-1 aspect-square w-full flex items-center justify-center',
        props.isSelected && 'bg-hover'
      )}
      onClick={() => props.onEmojiClick(props.emoji)}
      title={props.emoji.slug}
      role="option"
      aria-selected={props.isSelected}
    >
      {renderEmoji(props.emoji.emoji, props.size)}
    </button>
  );
}

function validFilter(filter: string | undefined): filter is string {
  return Boolean(filter && filter.trim().length > 0);
}

/** `p-1` on either side of a cell. */
const CELL_PADDING_PX = 8;

export function EmojiSelector(props: EmojiPickerProps): JSX.Element {
  const { groups, emojis: filteredEmojis, filter } = useEmojiData();
  const [virtualizer, setVirtualizer] = createSignal<VirtualizerHandle>();

  const columns = () => props.columns ?? 6;

  // Every emoji at once is about 1,900 buttons, enough that some browsers left
  // the picker blank, so only the rows in view are rendered.
  const sections = createMemo(() =>
    validFilter(props.nameFilter)
      ? [{ name: 'Search Results', emojis: filteredEmojis() }]
      : groups()
  );
  const layout = createMemo(() => emojiRows(sections(), columns()));
  const flatEmojis = createMemo(() =>
    sections().flatMap((section) => section.emojis)
  );

  const selectEmoji = (emoji: SimpleEmoji) => {
    recordEmojiUsage(emoji.emoji);
    props.onEmojiClick(emoji);
  };

  const [selectedIndex, setSelectedIndex] = createSignal(-1);

  createEffect(() => {
    setSelectedIndex(-1);
    if (!props.nameFilter) return;
    filter(props.nameFilter);
    virtualizer()?.scrollTo(0);
  });

  createEffect(
    on(selectedIndex, (index) => {
      const row = layout().rowOfEmoji[index];
      if (row === undefined) return;
      virtualizer()?.scrollToIndex(row, { align: 'nearest' });
    })
  );

  const handleKeyDown = (e: KeyboardEvent) => {
    if (
      props.keyboardScope &&
      e.target instanceof Node &&
      !props.keyboardScope.contains(e.target)
    )
      return;
    const emojisToUse = flatEmojis();
    if (emojisToUse.length === 0) return;

    const totalEmojis = emojisToUse.length;

    if (e.key === 'ArrowRight') {
      e.preventDefault();
      e.stopPropagation();
      setSelectedIndex((prev) => {
        if (prev === -1) return 0;
        return (prev + 1) % totalEmojis;
      });
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      e.stopPropagation();
      setSelectedIndex((prev) => {
        if (prev === -1) return totalEmojis - 1;
        return (prev - 1 + totalEmojis) % totalEmojis;
      });
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      e.stopPropagation();
      setSelectedIndex((prev) => {
        if (prev === -1) return 0;
        const nextIndex = prev + columns();
        return nextIndex >= totalEmojis ? prev : nextIndex;
      });
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      e.stopPropagation();
      setSelectedIndex((prev) => {
        if (prev === -1) return totalEmojis - 1;
        const nextIndex = prev - columns();
        return nextIndex < 0 ? prev : nextIndex;
      });
    } else if (e.key === 'Enter') {
      e.preventDefault();
      e.stopPropagation();
      if (selectedIndex() !== -1) {
        selectEmoji(emojisToUse[selectedIndex()]);
      }
    }
  };

  onMount(() => {
    document.addEventListener('keydown', handleKeyDown);
    onCleanup(() => {
      document.removeEventListener('keydown', handleKeyDown);
    });
  });

  // The row is the query container rather than the cell. A row's inline size
  // comes from its containing block alone, while a cell's comes from `1fr`
  // track sizing, which the cell's own contents can push out. Sizing a glyph
  // off its cell closes that loop, and it can settle with one emoji filling
  // the picker. `minmax(0, …)` keeps contents out of a track's minimum.
  const gridStyle = () => ({
    display: 'grid',
    'grid-template-columns': `repeat(${columns()}, minmax(0, 1fr))`,
    'container-type': 'inline-size',
  });

  // 90% of a cell's content box: its share of the row, less the `p-1` either
  // side that a cell's own content box would have excluded.
  const emojiSize = () =>
    `calc(0.9 * (100cqi / ${columns()} - ${CELL_PADDING_PX}px))`;

  return (
    <VList
      ref={setVirtualizer}
      data={layout().rows}
      class="overscroll-none [overflow-anchor:none]"
      style={{ width: '100%', height: '100%' }}
      role="listbox"
      aria-label="Emoji Selector"
    >
      {(row): JSX.Element => (
        <Switch>
          <Match when={row.kind === 'header' && row}>
            {(header) => (
              <p class="mt-2 pl-1 text-ink-extra-muted text-xs">
                {header().name}
              </p>
            )}
          </Match>
          <Match when={row.kind === 'emojis' && row}>
            {(emojiRow) => (
              <div style={gridStyle()}>
                <For each={emojiRow().emojis}>
                  {(emojiItem, index): JSX.Element => (
                    <EmojiOption
                      emoji={emojiItem}
                      onEmojiClick={selectEmoji}
                      size={emojiSize()}
                      isSelected={
                        selectedIndex() === emojiRow().start + index()
                      }
                    />
                  )}
                </For>
              </div>
            )}
          </Match>
        </Switch>
      )}
    </VList>
  );
}
