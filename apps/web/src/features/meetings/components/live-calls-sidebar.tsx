import { ViewSidebar } from '@app/components/view-shell/ViewSidebar';
import PhoneCallIcon from '@icon/system/fill/phone-call-fill.svg';
import XIcon from '@icon/system/regular/x.svg';
import { Key } from '@solid-primitives/keyed';
import { cn, Tooltip } from '@ui';
import { createUniqueId, Show } from 'solid-js';

export type LiveCallRow = {
  id: string;
  label: string;
  /** The user is already in this call, so the row opens it instead. */
  joined: boolean;
  /** The call is ringing for the user, so the row offers Dismiss. */
  ringing?: boolean;
};

export function LiveCallsSidebar<T extends LiveCallRow>(props: {
  calls: readonly T[];
  onSelect: (call: T) => void;
  onDismiss?: (call: T) => void;
}) {
  const titleId = createUniqueId();
  const action = (call: LiveCallRow) => (call.joined ? 'Open' : 'Join');

  return (
    <Show when={props.calls.length > 0}>
      <section
        aria-labelledby={titleId}
        data-live-calls-sidebar=""
        class="flex max-h-1/3 min-h-0 shrink-0 flex-col gap-(--sidebar-section-content-gap) px-(--sidebar-gutter)"
      >
        <h2
          id={titleId}
          class="flex h-(--sidebar-row-height) shrink-0 items-center gap-2 px-(--sidebar-item-inset) text-xs font-medium text-ink-muted"
        >
          <span class="size-1.5 rounded-full bg-accent motion-safe:animate-pulse" />
          Live
        </h2>
        <div class="flex min-h-0 flex-col gap-(--sidebar-row-gap) overflow-y-auto overscroll-contain">
          <Key each={props.calls} by="id">
            {(call) => {
              const dismissable = () => !!call().ringing && !!props.onDismiss;
              return (
                <div class="relative flex min-w-0 shrink-0 flex-col">
                  <Tooltip
                    label={call().label}
                    placement="right"
                    class="min-w-0"
                  >
                    <ViewSidebar.Item
                      aria-label={`${action(call())} ${call().label}`}
                      class={cn(
                        'bg-accent-bg text-ink not-disabled:hover:bg-accent-bg not-disabled:hover:overlay-hover',
                        dismissable() && 'pr-9'
                      )}
                      onClick={() => props.onSelect(call())}
                    >
                      <ViewSidebar.Icon class="text-accent">
                        <PhoneCallIcon />
                      </ViewSidebar.Icon>
                      <span class="min-w-0 flex-1 truncate">
                        {call().label}
                      </span>
                      <span
                        aria-hidden="true"
                        class="ml-auto shrink-0 text-xs font-medium text-accent"
                      >
                        {action(call())}
                      </span>
                    </ViewSidebar.Item>
                  </Tooltip>
                  <Show when={dismissable()}>
                    <span class="absolute right-(--sidebar-action-inset) top-1/2 flex -translate-y-1/2">
                      <ViewSidebar.Control
                        class="rounded-md"
                        aria-label={`Dismiss ${call().label}`}
                        onClick={() => props.onDismiss?.(call())}
                      >
                        <XIcon class="size-3" />
                      </ViewSidebar.Control>
                    </span>
                  </Show>
                </div>
              );
            }}
          </Key>
        </div>
      </section>
    </Show>
  );
}
