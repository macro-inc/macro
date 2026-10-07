import { Popover } from '@kobalte/core/popover';
import XIcon from '@phosphor/x.svg';
import { type JSX, Show } from 'solid-js';

export function ToolbarPopover(props: {
  label: string;
  count?: number;
  compact?: boolean;
  icon: JSX.Element;
  children: JSX.Element;
}) {
  return (
    <Popover
      placement="bottom-end"
      gutter={6}
      fitViewport
      overlap
      overflowPadding={8}
    >
      <Popover.Trigger
        class="flex h-8 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md px-2 text-xs outline-none hover:bg-hover hover:text-ink focus-visible:ring-2 focus-visible:ring-ink/50 data-expanded:bg-hover [&>svg]:shrink-0"
        classList={{
          'text-accent': !!props.count,
          'text-ink-muted': !props.count,
          'justify-center px-2': props.compact,
        }}
        aria-label={`${props.label}${props.count ? ` ${props.count}` : ''}`}
        title={props.label}
      >
        {props.icon}
        <Show when={!props.compact}>{props.label}</Show>
        <Show when={props.count}>
          <span class="flex min-w-4 items-center justify-center rounded bg-accent/10 px-1 text-[10px] font-medium text-accent">
            {props.count}
          </span>
        </Show>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          class="relative z-action-menu flex min-h-0 max-w-[calc(100vw-2rem)] flex-col rounded-lg border border-edge bg-menu text-sm text-ink shadow-menu outline-none [&_button:focus-visible]:ring-2 [&_button:focus-visible]:ring-ink/50"
          style={{
            'max-height':
              'min(36rem, var(--kb-popper-content-available-height, calc(100dvh - 1rem)), calc(100dvh - 1rem))',
          }}
        >
          <div class="flex shrink-0 items-center gap-5 px-3 pt-3 pb-3 pr-10">
            <Popover.Title class="flex-1 font-medium text-sm">
              {props.label}
            </Popover.Title>
          </div>
          <div class="min-h-0 overflow-y-auto overscroll-contain px-3 pb-3">
            {props.children}
          </div>
          <Popover.CloseButton
            aria-label={`Close ${props.label.toLowerCase()}`}
            class="absolute right-3 top-3 rounded p-1 text-ink-muted hover:bg-hover focus-visible:ring-2 focus-visible:ring-ink/50"
          >
            <XIcon class="size-3.5" />
          </Popover.CloseButton>
        </Popover.Content>
      </Popover.Portal>
    </Popover>
  );
}
