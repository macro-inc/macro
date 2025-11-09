import type { JSX } from 'solid-js';
import {
  createEffect,
  createMemo,
  createSignal,
  For,
  Match,
  onCleanup,
  onMount,
  Show,
  Switch,
} from 'solid-js';
import { type SimpleEmoji, useEmojiData } from './emojis';

export function renderEmoji(emoji: string, size?: string): JSX.Element {
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

export type EmojiEventHandler<T extends Event> = (
  emoji: string,
  event: T & {
    currentTarget: HTMLButtonElement;
    target: Element;
  }
) => void;

export interface EmojiPickerProps {
  nameFilter?: string;
  onEmojiClick: (emoji: SimpleEmoji) => void;
}

export interface EmojiOptionProps {
  emoji: SimpleEmoji;
  onEmojiClick: (emoji: SimpleEmoji) => void;
  isSelected: boolean;
}

export function EmojiSelector(props: EmojiPickerProps): JSX.Element {
  const { groups, emojis: filteredEmojis, filter } = useEmojiData();

  function EmojiOption(props: EmojiOptionProps): JSX.Element {
    return (
      <button
        type="button"
        class={`hover:bg-hover hover-transition-bg rounded-md p-1 ${props.isSelected ? 'bg-hover' : ''}`}
        onClick={() => props.onEmojiClick(props.emoji)}
        title={props.emoji.slug}
        role="option"
        aria-selected={props.isSelected}
      >
        {renderEmoji(props.emoji.emoji, '32px')}
      </button>
    );
  }

  createEffect(() => {
    if (!props.nameFilter) return;
    filter(props.nameFilter);
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

    const EMOJIS_PER_ROW = 6;
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
        const nextIndex = prev + EMOJIS_PER_ROW;
        return nextIndex >= totalEmojis ? prev : nextIndex;
      });
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      e.stopPropagation();
      setSelectedIndex((prev) => {
        if (prev === -1) return totalEmojis - 1;
        const nextIndex = prev - EMOJIS_PER_ROW;
        return nextIndex < 0 ? prev : nextIndex;
      });
    } else if (e.key === 'Enter' || e.key === ' ') {
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

  return (
    <div class="w-full" role="listbox" aria-label="Emoji Selector">
      {createMemo(() => {
        return (
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
                      <p class="text-ink-extra-muted text-xs w-full flex items-center justify-start">
                        {group.name}
                      </p>
                      <div class="flex flex-row flex-wrap">
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
                <span class="text-ink-extra-muted text-xs">Search Results</span>
              </div>

              <div class="flex flex-row flex-wrap">
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
        );
      })()}
    </div>
  );
}
