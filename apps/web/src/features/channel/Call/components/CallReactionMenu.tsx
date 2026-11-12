import { t } from '@app/lib/i18n';
import Smiley from '@icon/system/regular/smiley.svg';
import { Popover } from '@kobalte/core/popover';
import { Button, Dropdown } from '@ui';
import { createSignal, For, Show } from 'solid-js';
import {
  CALL_REACTION_EMOJIS,
  type CallReactionEmoji,
} from '../core/call-reactions';

export function CallReactionRow(props: {
  onReaction: (emoji: CallReactionEmoji) => void;
  inMenu?: boolean;
}) {
  const [focused, setFocused] = createSignal(0);
  const buttons: HTMLElement[] = [];
  return (
    <div
      role={props.inMenu ? 'group' : 'toolbar'}
      aria-label={t('calls.reactions')}
      class="flex items-center justify-center gap-1 p-1"
      onKeyDown={(event) => {
        if (
          props.inMenu &&
          ['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)
        )
          return;
        let offset = 0;
        if (['ArrowRight', 'ArrowDown'].includes(event.key)) offset = 1;
        if (['ArrowLeft', 'ArrowUp'].includes(event.key)) offset = -1;
        const jump = event.key === 'Home' || event.key === 'End';
        if (!offset && !jump) return;
        event.preventDefault();
        event.stopPropagation();
        let next = (focused() + offset + buttons.length) % buttons.length;
        if (event.key === 'Home') next = 0;
        if (event.key === 'End') next = buttons.length - 1;
        setFocused(next);
        buttons[next]?.focus();
      }}
    >
      <For each={CALL_REACTION_EMOJIS}>
        {(emoji, index) => (
          <Show
            when={props.inMenu}
            fallback={
              <Button
                ref={(element) => {
                  buttons[index()] = element;
                }}
                variant="ghost"
                size="icon-lg"
                aria-label={emoji}
                tabIndex={focused() === index() ? 0 : -1}
                onFocus={() => setFocused(index())}
                onClick={() => props.onReaction(emoji)}
              >
                <span class="text-xl">{emoji}</span>
              </Button>
            }
          >
            <Dropdown.Item
              ref={(element: HTMLDivElement) => {
                buttons[index()] = element;
              }}
              class="size-10 shrink-0 justify-center rounded-full p-0"
              aria-label={emoji}
              textValue={emoji}
              closeOnSelect={false}
              onFocus={() => setFocused(index())}
              onSelect={() => props.onReaction(emoji)}
            >
              <span class="text-xl">{emoji}</span>
            </Dropdown.Item>
          </Show>
        )}
      </For>
    </div>
  );
}

export function CallReactionMenu(props: {
  onReaction: (emoji: CallReactionEmoji) => void;
  onOpenChange: (open: boolean) => void;
  compact?: boolean;
  smallIcon?: boolean;
}) {
  const [open, setOpen] = createSignal(false);
  const [trigger, setTrigger] = createSignal<HTMLButtonElement>();
  return (
    <Popover
      open={open()}
      onOpenChange={(value) => {
        setOpen(value);
        props.onOpenChange(value);
      }}
      placement="top"
      gutter={8}
    >
      <Popover.Trigger
        ref={setTrigger}
        as={Button}
        variant={open() ? 'accent' : 'secondary'}
        size={props.compact ? 'icon-md' : 'icon-lg'}
        aria-label={t('calls.reactions')}
        tooltip={{
          content: t('calls.reactions'),
          placement: 'top',
          disabled: open(),
        }}
      >
        <Smiley class={props.smallIcon ? 'size-3.5' : 'size-5'} />
      </Popover.Trigger>
      <Show when={open()}>
        <Popover.Portal
          mount={trigger()?.closest<HTMLElement>('.portal-scope') ?? undefined}
        >
          <Popover.Content
            aria-label={t('calls.reactions')}
            class="menu-surface z-action-menu rounded-full p-1 outline-none"
          >
            <CallReactionRow onReaction={props.onReaction} />
          </Popover.Content>
        </Popover.Portal>
      </Show>
    </Popover>
  );
}
