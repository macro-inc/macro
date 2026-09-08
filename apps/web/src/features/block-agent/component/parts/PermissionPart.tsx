/** Read-only permission record. Pending choices remain visible, without fake actions. */
import Check from '@phosphor/check.svg';
import Shield from '@phosphor/shield-check.svg';
import type { MessagePart } from '@service-agent-fold/generated/types';
import { For, Show } from 'solid-js';

export function PermissionPart(props: {
  part: Extract<MessagePart, { kind: 'permission' }>;
}) {
  const chosen = (id: string) =>
    props.part.outcome.kind === 'selected' &&
    props.part.outcome.optionId === id;
  const status = () => {
    const outcome = props.part.outcome;
    if (outcome.kind === 'pending') return 'Awaiting permission';
    if (outcome.kind === 'cancelled') return 'Cancelled';
    if (outcome.kind === 'errored') return 'Failed';
    return 'Answered';
  };
  return (
    <section
      aria-label="Permission requested"
      class="overflow-hidden rounded-xl border border-edge-muted bg-ink/2"
    >
      <header class="flex min-h-12 items-center gap-3 border-b border-edge-muted px-4 text-sm">
        <Shield class="size-4 text-ink-muted" />
        <span class="flex-1 font-medium">Permission requested</span>
        <span class="rounded-full bg-ink/5 px-2.5 py-1 text-xs text-ink-muted">
          {status()}
        </span>
      </header>
      <div class="space-y-2 p-3">
        <For each={props.part.options}>
          {(option) => (
            <div
              class="flex items-center gap-3 rounded-lg border border-edge-muted px-3 py-2.5 text-[13px]"
              classList={{
                'bg-success/5 border-success/20': chosen(option.id),
              }}
            >
              <span class="flex size-4 items-center justify-center rounded-full border border-edge-muted">
                <Show when={chosen(option.id)}>
                  <Check class="size-3 text-success" />
                </Show>
              </span>
              {option.name}
            </div>
          )}
        </For>
      </div>
    </section>
  );
}
