import { EmojiSelector } from '@core/component/Emoji/EmojiSelector';
import type { SimpleEmoji } from '@core/component/Emoji/emojis';
import { resolveEmojiFromUnicode } from '@core/component/Emoji/emojis';
import { IconButton } from '@core/component/IconButton';
import { DEV_MODE_ENV } from '@core/constant/featureFlags';
import { ContextMenu } from '@kobalte/core/context-menu';
import { Popover } from '@kobalte/core/popover';
import SearchIcon from '@phosphor-icons/core/regular/magnifying-glass.svg?component-solid';
import PlusIcon from '@phosphor-icons/core/regular/plus.svg';
import SmileIcon from '@phosphor-icons/core/regular/smiley.svg?component-solid';
import {
  createEffect,
  createSignal,
  For,
  Match,
  onMount,
  Show,
  Switch,
} from 'solid-js';
import { Dynamic } from 'solid-js/web';

type ReactionQuickSelectorProps = {
  onEmojiClick: (emoji: SimpleEmoji) => void;
  setSearchOpen?: (open: boolean) => void;
  handleClose?: () => void;
  hideSearchButton?: boolean;
  insideMenu?: boolean;
  showFocusRing?: boolean;
};

export function ReactionQuickSelector(props: ReactionQuickSelectorProps) {
  const [selectedIndex, setSelectedIndex] = createSignal(-1);
  let containerRef: HTMLDivElement | undefined;

  const reactions = DEV_MODE_ENV
    ? ['❤️', '👍', '👎', '😂', '😡', '‼️', '🎫']
    : ['❤️', '👍', '👎', '😂', '😡', '‼️'];

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'ArrowLeft') {
      e.preventDefault();
      e.stopPropagation();
      setSelectedIndex((prev) => {
        if (prev === -1) return reactions.length;
        return (prev - 1 + (reactions.length + 1)) % (reactions.length + 1);
      });
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      e.stopPropagation();
      setSelectedIndex((prev) => {
        if (prev === -1) return 0;
        return (prev + 1) % (reactions.length + 1);
      });
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      e.stopPropagation();
      if (selectedIndex() === -1) return;

      if (selectedIndex() === reactions.length) {
        props.setSearchOpen?.(true);
        return;
      }

      const emoji = resolveEmojiFromUnicode(reactions[selectedIndex()]);
      if (emoji) {
        props.onEmojiClick(emoji);
        props.handleClose?.();
      }
    }
  };

  return (
    <Dynamic
      component={props.insideMenu ? ContextMenu.Item : 'div'}
      ref={containerRef}
      class={`w-fit flex items-center gap-1.5 px-4 py-2 bg-menu rounded-full shadow-lg border border-edge-muted ${props.showFocusRing ? 'focus-visible:focus-border' : ''}`}
      onKeyDown={handleKeyDown}
      tabIndex={-1}
      {...(props.insideMenu && {
        closeOnSelect: !(selectedIndex() === reactions.length + 1),
      })}
    >
      <For each={reactions}>
        {(reaction, index) => (
          <button
            class={`select-none rounded-full text-[32px]/[32px] hover:scale-110 transition-all duration-200 ${
              index() === selectedIndex()
                ? 'ring-2 ring-offset-4 ring-accent'
                : ''
            }`}
            onClick={() => {
              const emoji = resolveEmojiFromUnicode(reaction);
              if (emoji) props.onEmojiClick?.(emoji);
              props.handleClose?.();
            }}
            onTouchStart={() => {
              const emoji = resolveEmojiFromUnicode(reaction);
              if (emoji) props.onEmojiClick?.(emoji);
              props.handleClose?.();
            }}
            role="option"
            aria-selected={index() === selectedIndex()}
          >
            {reaction}
          </button>
        )}
      </For>
      <Show when={!props.hideSearchButton}>
        <IconButton
          icon={PlusIcon}
          iconSize={20}
          class={`h-8! w-8! bg-menu! hover:bg-hover! hover-transition-bg rounded-full! p-2 ${selectedIndex() === reactions.length ? 'ring-2 ring-offset-4 ring-accent' : ''}`}
          onClick={() => {
            props.setSearchOpen?.(true);
          }}
          onTouchStart={() => {
            props.setSearchOpen?.(true);
          }}
          tabIndex={selectedIndex() === reactions.length ? 0 : -1}
          role="button"
          aria-label="More reactions"
        />
      </Show>
    </Dynamic>
  );
}

type EmojiSearchSelectorProps = {
  onEmojiClick?: (emoji: SimpleEmoji) => void;
  handleClose: () => void;
  fullWidth?: boolean;
  insideMenu?: boolean;
};

export function EmojiSearchSelector(props: EmojiSearchSelectorProps) {
  const [input, setInput] = createSignal('');
  let searchInputRef: HTMLInputElement | undefined;
  let containerRef: HTMLDivElement | undefined;

  onMount(() => {
    setTimeout(() => {
      searchInputRef?.focus();
    }, 0);
  });

  createEffect(() => {
    if (containerRef && !containerRef.contains(document.activeElement)) {
      containerRef?.focus();
    }
  });

  return (
    <Dynamic
      component={props.insideMenu ? ContextMenu.Item : 'div'}
      class={`${props.fullWidth ? 'w-full' : 'w-[258px]'} h-[315px] pl-2 pt-2 rounded-md flex flex-col bg-menu shadow-lg border border-edge-muted`}
      role="dialog"
      aria-label="Emoji search"
      ref={containerRef}
      {...(props.insideMenu && { closeOnSelect: false })}
    >
      <div class="flex pr-2 w-full">
        <div class="flex flex-row items-center text-ink gap-1 border border-edge-muted rounded-md px-2 py-1 text-xs w-full">
          <SearchIcon class="w-3 h-3" />
          <input
            ref={searchInputRef}
            value={input()}
            onInput={(e) => setInput(e.target.value)}
            placeholder="Search emojis"
            role="searchbox"
            aria-label="Search emojis"
          />
        </div>
      </div>
      <div class="flex-grow overflow-y-auto overflow-x-hidden mt-2">
        <EmojiSelector
          nameFilter={input()}
          onEmojiClick={(emoji) => {
            props.onEmojiClick?.(emoji);
            props.handleClose();
          }}
        />
      </div>
    </Dynamic>
  );
}

type ReactionSelectorProps = {
  onEmojiClick: (emoji: SimpleEmoji) => void;
  onOpenChange?: (isOpen: boolean) => void;
};

export function ReactionSelector(props: ReactionSelectorProps) {
  let searchInputRef: HTMLInputElement | undefined;

  const [openPopover, setOpenPopover] = createSignal(false);

  const [searchOpen, setSearchOpen] = createSignal(false);

  createEffect(() => {
    if (searchOpen()) {
      setTimeout(() => {
        if (searchInputRef) {
          searchInputRef.focus();
        }
      });
    }
  });

  const handleClose = () => {
    setSearchOpen(false);
    setOpenPopover(false);
  };

  const onOpenChange = (isOpen: boolean) => {
    if (!isOpen) {
      handleClose();
    }
    setOpenPopover(isOpen);
    props.onOpenChange?.(isOpen);
  };

  return (
    <Popover
      placement="top"
      onOpenChange={onOpenChange}
      overflowPadding={8}
      slide={true}
      open={openPopover()}
    >
      <Popover.Trigger>
        <IconButton icon={SmileIcon} tabIndex={-1} />
      </Popover.Trigger>

      <Popover.Portal>
        <Popover.Content class="z-modal">
          <Popover.Arrow class="fill-menu" />
          <Switch>
            <Match when={!searchOpen()}>
              <ReactionQuickSelector
                onEmojiClick={props.onEmojiClick}
                setSearchOpen={setSearchOpen}
                handleClose={handleClose}
              />
            </Match>
            <Match when={searchOpen()}>
              <EmojiSearchSelector
                onEmojiClick={props.onEmojiClick}
                handleClose={handleClose}
              />
            </Match>
          </Switch>
        </Popover.Content>
      </Popover.Portal>
    </Popover>
  );
}
