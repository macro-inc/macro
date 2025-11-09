import { BozzyBracketInnerSibling } from '@core/component/BozzyBracket';
import { resolveEmoji, useEmojiData } from '@core/component/Emoji/emojis';
import { type PortalScope, ScopedPortal } from '@core/component/ScopedPortal';
import clickOutside from '@core/directive/clickOutside';
import { InlineSearchNode } from '@lexical-core';
import { debounce } from '@solid-primitives/scheduled';
import type { LexicalEditor } from 'lexical';
import {
  createEffect,
  createSignal,
  onCleanup,
  onMount,
  Show,
  untrack,
} from 'solid-js';
import { type VirtualizerHandle, VList } from 'virtua/solid';
import { floatWithSelection } from '../../directive/floatWithSelection';
import {
  CLOSE_EMOJI_SEARCH_COMMAND,
  INSERT_TEXT_COMMAND,
  REMOVE_EMOJI_SEARCH_COMMAND,
} from '../../plugins';
import type { MenuOperations } from '../../shared/inlineMenu';

false && clickOutside;
false && floatWithSelection;

export type EmojiMenuProps = {
  menu: MenuOperations;
  editor: LexicalEditor;
  /** whether the menu checks against block boundary in floating middleware. uses floating-ui default if false. */
  useBlockBoundary?: boolean;
  portalScope?: PortalScope;
};

export function EmojiItem(props: {
  emoji: string;
  name: string;
  selected: boolean;
  setIndex: (index: number) => void;
  setOpen: (open: boolean) => void;
  onSelect?: () => void;
  index: number;
}) {
  return (
    <div
      on:mouseover={() => props.setIndex(props.index)}
      class="group flex items-center p-1"
      classList={{ 'bg-active bracket': props.selected }}
      on:mousedown={(e) => {
        e.preventDefault();
        e.stopPropagation();
        props.onSelect?.();
      }}
    >
      <p class="flex flex-row gap-2 items-center w-full">
        {props.emoji}
        <span class="text-ink text-xs font-medium font-sans grow overflow-hidden text-nowrap truncate">
          {props.name}
        </span>
      </p>
    </div>
  );
}

export function EmojiMenu(props: EmojiMenuProps) {
  const [mountSelection, setMountSelection] = createSignal<Selection | null>();
  const [selectedIndex, setSelectedIndex] = createSignal(0);
  const [virtualHandle, setVirtualHandle] = createSignal<VirtualizerHandle>();

  const [searchTerm, setSearchTerm] = createSignal(props.menu.searchTerm());
  const debouncedSetSearchTerm = debounce(
    (term: string) => setSearchTerm(term),
    200
  );

  createEffect(() => {
    debouncedSetSearchTerm(props.menu.searchTerm().toLowerCase());
  });

  const { emojis: emojiOptions, filter } = useEmojiData();

  let menuRef!: HTMLDivElement;

  createEffect(() => {
    if (props.menu.isOpen()) {
      setMountSelection(document.getSelection());
      setSelectedIndex(0);
    } else {
      setMountSelection(null);
    }
  });

  const [, setEditorParent] = createSignal<HTMLElement>();
  const cleanupRootListener = props.editor.registerRootListener(() => {
    setEditorParent(props.editor.getRootElement()?.parentElement ?? undefined);
  });
  onCleanup(cleanupRootListener);

  function insertEmoji(emoji: string) {
    props.editor.dispatchCommand(REMOVE_EMOJI_SEARCH_COMMAND, undefined);
    props.editor.dispatchCommand(INSERT_TEXT_COMMAND, emoji);
  }

  function isEnclosedEmoji(text: string) {
    return text.startsWith(':') && text.endsWith(':');
  }

  createEffect(() => {
    // the emoji filter is slow on long search strings, so only do it if the menu is open
    const term = searchTerm();
    if (props.menu.isOpen()) {
      filter(term);
    }
  });

  onMount(() => {
    props.editor.registerNodeTransform(
      InlineSearchNode,
      (node: InlineSearchNode) => {
        const text = node.getTextContent();
        if (isEnclosedEmoji(text)) {
          const resolved = resolveEmoji(text);
          if (resolved) {
            insertEmoji(resolved);
          }
        }
      }
    );
  });

  const handleKeyDown = (e: KeyboardEvent) => {
    if (!props.menu.isOpen()) return;
    const items = emojiOptions();
    const selectedItem = items[selectedIndex()];

    switch (e.key) {
      case 'Escape':
        e.preventDefault();
        e.stopPropagation();
        props.menu.setIsOpen(false);
        props.editor.dispatchCommand(CLOSE_EMOJI_SEARCH_COMMAND, undefined);
        break;

      case 'ArrowDown': {
        e.preventDefault();
        e.stopPropagation();
        setSelectedIndex((prev) => (prev + 1) % items.length);
        const endIndex = virtualHandle()?.findEndIndex();
        if (endIndex && endIndex === selectedIndex()) {
          virtualHandle()?.scrollToIndex(selectedIndex() + 1, {
            align: 'center',
          });
        }
        break;
      }

      case 'ArrowUp': {
        e.preventDefault();
        e.stopPropagation();
        setSelectedIndex((prev) => (prev - 1 + items.length) % items.length);
        const startIndex = virtualHandle()?.findStartIndex();
        if (startIndex && startIndex === selectedIndex()) {
          virtualHandle()?.scrollToIndex(selectedIndex() - 1, {
            align: 'center',
          });
        }
        break;
      }

      case 'ArrowLeft':
      case 'ArrowRight':
        e.preventDefault();
        break;

      case 'Tab':
        e.preventDefault();
        e.stopPropagation();
        if (e.shiftKey) {
          setSelectedIndex((prev) => (prev - 1 + items.length) % items.length);
          const startIndex = virtualHandle()?.findStartIndex();
          if (startIndex && startIndex === selectedIndex()) {
            virtualHandle()?.scrollToIndex(selectedIndex() - 1, {
              align: 'center',
            });
          }
        } else {
          setSelectedIndex((prev) => (prev + 1) % items.length);
          const endIndex = virtualHandle()?.findEndIndex();
          if (endIndex && endIndex === selectedIndex()) {
            virtualHandle()?.scrollToIndex(selectedIndex() + 1, {
              align: 'center',
            });
          }
        }
        break;

      case 'Enter':
        e.preventDefault();
        e.stopPropagation();
        if (selectedItem) {
          insertEmoji(selectedItem.emoji);
        } else {
          props.editor.dispatchCommand(CLOSE_EMOJI_SEARCH_COMMAND, undefined);
        }
        break;
    }
  };

  onMount(() => {
    document.addEventListener('keydown', handleKeyDown, { capture: true });
    onCleanup(() => {
      document.removeEventListener('keydown', handleKeyDown, { capture: true });
    });
  });
  const focusOut = () => {
    props.editor.dispatchCommand(CLOSE_EMOJI_SEARCH_COMMAND, undefined);
    props.menu.setIsOpen(false);
  };
  onMount(() => {
    document.addEventListener('focusout', focusOut);
    onCleanup(() => {
      document.removeEventListener('focusout', focusOut);
    });
  });

  createEffect(() => {
    props.menu.searchTerm;
    setSelectedIndex(0);
  });

  createEffect(() => {
    if (selectedIndex() >= emojiOptions().length) {
      setSelectedIndex(emojiOptions().length - 1);
    }
  });

  return (
    <Show when={props.menu.isOpen()}>
      <ScopedPortal scope={props.portalScope}>
        <div
          class="cursor-default select-none w-48 z-modal-content"
          use:floatWithSelection={{
            selection: untrack(mountSelection),
            reactiveOnContainer: props.editor.getRootElement(),
            useBlockBoundary: props.useBlockBoundary,
          }}
          use:clickOutside={() => {
            props.editor.dispatchCommand(CLOSE_EMOJI_SEARCH_COMMAND, undefined);
            props.menu.setIsOpen(false);
          }}
          ref={menuRef}
        >
          <div class="relative overflow-hidden ring-1 ring-edge bg-menu shadow-xl py-2">
            <div class="flex flex-col gap-1 pl-1 w-full">
              <Show
                when={emojiOptions().length > 0}
                fallback={
                  <div class="px-2 text text-ink-muted">No results</div>
                }
              >
                <VList
                  data={emojiOptions()}
                  ref={setVirtualHandle}
                  style={{
                    height: '200px',
                    'max-height': '100%',
                    width: '100%',
                  }}
                >
                  {(emojiItem, index) => (
                    <EmojiItem
                      emoji={emojiItem.emoji}
                      name={emojiItem.slug}
                      selected={selectedIndex() === index()}
                      onSelect={() => {
                        insertEmoji(emojiItem.emoji);
                        props.menu.setIsOpen(false);
                      }}
                      setIndex={setSelectedIndex}
                      setOpen={props.menu.setIsOpen}
                      index={index()}
                    />
                  )}
                </VList>
              </Show>
            </div>
          </div>
          <BozzyBracketInnerSibling animOnOpen={true} />
        </div>
      </ScopedPortal>
    </Show>
  );
}
