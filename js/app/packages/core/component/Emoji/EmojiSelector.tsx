import { cn } from '@ui';
import type { JSX } from 'solid-js';
import {
  createEffect,
  createSignal,
  For,
  Match,
  onCleanup,
  onMount,
  Show,
  Switch,
} from 'solid-js';
import { type SimpleEmoji, useEmojiData } from './emojis';

function renderEmoji(emoji: string, size?: string): JSX.Element {
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
}

interface EmojiOptionProps {
  emoji: SimpleEmoji;
  onEmojiClick: (emoji: SimpleEmoji) => void;
  isSelected: boolean;
}

export function EmojiSelector(props: EmojiPickerProps): JSX.Element {
  const { groups, emojis: filteredEmojis, filter } = useEmojiData();
  let scrollEl!: HTMLDivElement;

  const columns = () => props.columns ?? 6;

  function EmojiOption(props: EmojiOptionProps): JSX.Element {
    return (
      <button
        type="button"
        class={cn(
          'hover:bg-hover hover-transition-bg rounded-md p-1 aspect-square w-full flex items-center justify-center',
          props.isSelected && 'bg-hover'
        )}
        style={{ 'container-type': 'inline-size' }}
        onClick={() => props.onEmojiClick(props.emoji)}
        title={props.emoji.slug}
        role="option"
        aria-selected={props.isSelected}
      >
        {renderEmoji(props.emoji.emoji, '90cqi')}
      </button>
    );
  }

  createEffect(() => {
    if (!props.nameFilter) return;
    filter(props.nameFilter);
    scrollEl.scrollTop = 0;
  });

  function validFilter(filter: string | undefined) {
    return filter && filter.trim().length > 0;
  }

  const [selectedIndex, setSelectedIndex] = createSignal(-1);

  const handleKeyDown = (e: KeyboardEvent) => {
    const emojisToUse = validFilter(props.nameFilter)
      ? filteredEmojis()
      : groups.flatMap((g) => g.emojis);
    if (!emojisToUse || emojisToUse.length === 0) return;

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
        props.onEmojiClick(emojisToUse[selectedIndex()]);
      }
    }
  };

  onMount(() => {
    document.addEventListener('keydown', handleKeyDown);
    onCleanup(() => {
      document.removeEventListener('keydown', handleKeyDown);
    });
  });

  const gridStyle = () => ({
    display: 'grid',
    'grid-template-columns': `repeat(${columns()}, 1fr)`,
  });

  return (
    <div
      ref={scrollEl}
      class="size-full overflow-y-auto [overflow-anchor:none]"
      role="listbox"
      aria-label="Emoji Selector"
    >
      <Switch>
        <Match
          when={
            !validFilter(props.nameFilter) || filteredEmojis() === undefined
          }
        >
          <For each={groups}>
            {(group): JSX.Element => (
              <Show when={group.emojis.length > 0}>
                <div class="mt-2 w-full">
                  <p class="pl-1 text-ink-extra-muted text-xs">{group.name}</p>
                  <div style={gridStyle()}>
                    <For each={group.emojis}>
                      {(emojiItem, index): JSX.Element => (
                        <EmojiOption
                          emoji={emojiItem}
                          onEmojiClick={props.onEmojiClick}
                          isSelected={selectedIndex() === index()}
                        />
                      )}
                    </For>
                  </div>
                </div>
              </Show>
            )}
          </For>
        </Match>
        <Match when={filteredEmojis() !== undefined}>
          <div class="mt-2">
            <span class="pl-1 text-ink-extra-muted text-xs">
              Search Results
            </span>
          </div>

          <div style={gridStyle()}>
            <For each={filteredEmojis()}>
              {(emojiItem, index): JSX.Element => (
                <EmojiOption
                  emoji={emojiItem}
                  onEmojiClick={props.onEmojiClick}
                  isSelected={selectedIndex() === index()}
                />
              )}
            </For>
          </div>
        </Match>
      </Switch>
    </div>
  );
}
