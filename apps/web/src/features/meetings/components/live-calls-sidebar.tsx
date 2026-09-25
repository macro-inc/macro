import { ViewSidebar } from '@app/components/view-shell/ViewSidebar';
import PhoneIncomingIcon from '@phosphor-fill/phone-incoming-fill.svg';
import { Key } from '@solid-primitives/keyed';
import { Tooltip } from '@ui';
import { createUniqueId, Show } from 'solid-js';
import type { ActiveQuickCall } from '../context/call-sidebar';

type LiveCallDisplay = Pick<ActiveQuickCall, 'id' | 'url'> & {
  label: string;
};

export function LiveCallsSidebar(props: {
  calls: readonly LiveCallDisplay[];
  onJoin: (call: LiveCallDisplay) => void;
}) {
  const titleId = createUniqueId();

  return (
    <Show when={props.calls.length > 0}>
      <section
        aria-labelledby={titleId}
        data-live-calls-sidebar=""
        class="flex max-h-1/3 min-h-0 shrink-0 flex-col gap-(--sidebar-section-content-gap) px-(--sidebar-gutter)"
      >
        <h2
          id={titleId}
          class="flex h-(--sidebar-row-height) shrink-0 items-center px-(--sidebar-item-inset) text-xs font-medium text-ink-muted"
        >
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
                  aria-label={`Join ${call().label}`}
                  onClick={() => props.onJoin(call())}
                >
                  <ViewSidebar.Icon class="text-accent">
                    <PhoneIncomingIcon class="incoming-call-shake" />
                  </ViewSidebar.Icon>
                  <span class="min-w-0 flex-1 truncate">{call().label}</span>
                </ViewSidebar.Item>
              </Tooltip>
            )}
          </Key>
        </div>
      </section>
    </Show>
  );
}
