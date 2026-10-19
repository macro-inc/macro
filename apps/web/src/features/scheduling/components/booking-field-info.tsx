import { Popover } from '@kobalte/core/popover';
import Info from '@phosphor/info.svg';
import { Button } from '@ui';
import { createSignal, type JSX } from 'solid-js';

export function BookingFieldInfo(props: {
  label: string;
  description: string;
  children?: JSX.Element;
}) {
  const [trigger, setTrigger] = createSignal<HTMLButtonElement>();
  let restoreTriggerFocus = true;
  return (
    <Popover
      placement="top-start"
      gutter={8}
      modal={false}
      onOpenChange={(open) => {
        if (open) restoreTriggerFocus = true;
      }}
    >
      <Popover.Trigger
        as={Button}
        ref={setTrigger}
        type="button"
        variant="ghost"
        size="icon-xs"
        aria-label={`About ${props.label.toLowerCase()}`}
        class="text-ink-muted"
      >
        {props.children ?? <Info class="size-3.5" aria-hidden="true" />}
      </Popover.Trigger>
      <Popover.Portal
        mount={trigger()?.closest<HTMLElement>('.portal-scope') ?? undefined}
      >
        <Popover.Content
          onInteractOutside={() => {
            restoreTriggerFocus = false;
          }}
          onCloseAutoFocus={(event) => {
            if (!restoreTriggerFocus) return;
            event.preventDefault();
            trigger()?.focus({ preventScroll: true });
          }}
          class="menu-surface z-action-menu w-72 max-w-[min(18rem,var(--kb-popper-content-available-width),calc(100vw-2rem))] p-3 text-xs leading-relaxed whitespace-normal break-words outline-none"
        >
          <Popover.Title class="sr-only">
            About {props.label.toLowerCase()}
          </Popover.Title>
          <Popover.Description>{props.description}</Popover.Description>
        </Popover.Content>
      </Popover.Portal>
    </Popover>
  );
}
