import { ViewSidebar } from '@app/components/view-shell/ViewSidebar';
import PhoneCallIcon from '@icon/system/fill/phone-call-fill.svg';
import { Key } from '@solid-primitives/keyed';
import { Tooltip } from '@ui';
import { createUniqueId, Show } from 'solid-js';

export type LiveCallRow = {
  id: string;
  label: string;
  /** The user is already in this call, so the row opens it instead. */
  joined: boolean;
};

export function LiveCallsSidebar<T extends LiveCallRow>(props: {
  calls: readonly T[];
  onSelect: (call: T) => void;
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
            {(call) => (
              <Tooltip
                label={call().label}
                placement="right"
                class="min-w-0 shrink-0"
              >
                <ViewSidebar.Item
                  aria-label={`${action(call())} ${call().label}`}
                  class="bg-accent-bg text-ink not-disabled:hover:bg-accent-bg not-disabled:hover:overlay-hover"
                  onClick={() => props.onSelect(call())}
                >
                  <ViewSidebar.Icon class="text-accent">
                    <PhoneCallIcon />
                  </ViewSidebar.Icon>
                  <span class="min-w-0 flex-1 truncate">{call().label}</span>
                  <span
                    aria-hidden="true"
                    class="ml-auto shrink-0 text-xs font-medium text-accent"
                  >
                    {action(call())}
                  </span>
                </ViewSidebar.Item>
              </Tooltip>
            )}
          </Key>
        </div>
      </section>
    </Show>
  );
}
