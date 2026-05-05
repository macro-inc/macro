import { EmojiSelector } from '@core/component/Emoji/EmojiSelector';
import { Popover } from '@kobalte/core/popover';
import { Layer } from '@ui';
import { createSignal, splitProps, type JSX } from 'solid-js';

type EmojiReactionPopoverPlacement = 'top' | 'right' | 'bottom' | 'left';

type ButtonDataAttributes = {
  [key in `data-${string}`]?: string | number | boolean | undefined;
};

type EmojiReactionPopoverProps = {
  open: boolean;
  onOpenChange: (isOpen: boolean) => void;
  onEmojiSelect: (emoji: string) => void;
  trigger: JSX.Element;
  triggerProps?: JSX.ButtonHTMLAttributes<HTMLButtonElement> &
    ButtonDataAttributes;
  placement?: EmojiReactionPopoverPlacement;
};

export function EmojiReactionPopover(props: EmojiReactionPopoverProps) {
  const [local] = splitProps(props, [
    'open',
    'onOpenChange',
    'onEmojiSelect',
    'trigger',
    'triggerProps',
    'placement',
  ]);
  const [query, setQuery] = createSignal('');

  return (
    <Popover
      placement={local.placement ?? 'top'}
      onOpenChange={local.onOpenChange}
      open={local.open}
      overflowPadding={8}
      slide={true}
    >
      <Popover.Trigger type="button" {...local.triggerProps}>
        {local.trigger}
      </Popover.Trigger>
      <Popover.Portal>
        <Layer depth={3}>
          <Popover.Content class="z-modal">
            <Popover.Arrow class="fill-menu" />
            <div
              class="w-[258px] h-[315px] pl-2 pt-2 rounded-md flex flex-col bg-menu shadow-lg border border-edge"
              role="dialog"
              aria-label="Emoji search"
            >
              <div class="flex pr-2 w-full">
                <div class="flex flex-row items-center text-ink gap-1 border border-edge-muted rounded-md px-2 py-1 text-xs w-full">
                  <input
                    value={query()}
                    onInput={(event) => setQuery(event.currentTarget.value)}
                    onKeyDown={(event) => {
                      if (event.key !== 'Escape') return;
                      event.preventDefault();
                      local.onOpenChange(false);
                    }}
                    placeholder="Search emojis"
                    role="searchbox"
                    aria-label="Search emojis"
                  />
                </div>
              </div>
              <div class="grow overflow-y-auto overflow-x-hidden mt-2">
                <EmojiSelector
                  nameFilter={query()}
                  onEmojiClick={(emoji) => {
                    local.onEmojiSelect(emoji.emoji);
                    local.onOpenChange(false);
                  }}
                />
              </div>
            </div>
          </Popover.Content>
        </Layer>
      </Popover.Portal>
    </Popover>
  );
}
