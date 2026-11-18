import { useUserId } from '@core/context/user';
import { useEmailLinksQuery } from '@queries/email/link';
import { Checkbox } from '@ui';
import { type Accessor, For, Show } from 'solid-js';
import { MAX_INBOXES } from './core/routine-triggers';

/** The inboxes the person reads: their own and those shared with them. */
function useInboxes() {
  const links = useEmailLinksQuery();
  return {
    links: () => links.data?.links ?? [],
    loading: () => links.isPending,
    failed: () => links.isError,
  };
}

/** "Your inbox", or "Your inboxes" once the person reads more than one. */
export function InboxScopeLabel() {
  const { links } = useInboxes();
  const label = () => (links().length > 1 ? 'Your inboxes' : 'Your inbox');
  return <span title={label()}>{label()}</span>;
}

/** "team@example.com", or "2 inboxes". */
export function RoutineInboxesLabel(props: { inboxes: string[] }) {
  const { links } = useInboxes();
  const label = () => {
    if (props.inboxes.length > 1) return `${props.inboxes.length} inboxes`;
    const link = links().find((item) => item.id === props.inboxes[0]);
    return link?.email_address ?? 'A disconnected inbox';
  };
  return <span title={label()}>{label()}</span>;
}

/**
 * The person's inboxes to check. None checked watches every one; an inbox
 * picked before it was disconnected stays listed so it can be unchecked.
 */
export function RoutineInboxPicker(props: {
  inboxes: Accessor<string[]>;
  onChange: (inboxes: string[]) => void;
}) {
  const { links, loading, failed } = useInboxes();
  const userId = useUserId();
  const missing = () =>
    props.inboxes().filter((id) => !links().some((link) => link.id === id));
  const checked = (id: string) => props.inboxes().includes(id);
  const toggle = (id: string, on: boolean) =>
    props.onChange(
      on
        ? [...props.inboxes(), id]
        : props.inboxes().filter((inbox) => inbox !== id)
    );
  return (
    <div class="grid gap-1.5">
      <span class="text-xs font-medium">Inboxes</span>
      <Show
        when={!loading()}
        fallback={<p class="text-xs text-ink-muted">Loading…</p>}
      >
        <Show
          when={!failed()}
          fallback={
            <p class="text-xs text-failure">Your inboxes couldn’t be listed.</p>
          }
        >
          <div class="grid gap-0.5 rounded-lg border border-edge-muted p-1">
            <For each={links()}>
              {(link) => (
                <Checkbox
                  class="flex min-h-8 items-center gap-2 rounded-md px-2 py-1 not-touch:hover:bg-hover touch:min-h-11"
                  checked={checked(link.id)}
                  disabled={
                    !checked(link.id) && props.inboxes().length >= MAX_INBOXES
                  }
                  onChange={(on) => toggle(link.id, on)}
                >
                  <Checkbox.Control />
                  <Checkbox.Label class="flex min-w-0 flex-col text-sm font-normal">
                    <span class="truncate">{link.email_address}</span>
                    <Show when={link.macro_id !== userId()}>
                      <span class="text-xs text-ink-muted">
                        Shared with you
                      </span>
                    </Show>
                  </Checkbox.Label>
                </Checkbox>
              )}
            </For>
            <For each={missing()}>
              {(id) => (
                <Checkbox
                  class="flex min-h-8 items-center gap-2 rounded-md px-2 py-1 not-touch:hover:bg-hover touch:min-h-11"
                  checked
                  onChange={() => toggle(id, false)}
                >
                  <Checkbox.Control />
                  <Checkbox.Label class="text-sm font-normal text-ink-muted">
                    A disconnected inbox
                  </Checkbox.Label>
                </Checkbox>
              )}
            </For>
          </div>
          <p class="text-xs text-ink-muted">
            {props.inboxes().length
              ? 'Runs only for mail into the inboxes checked.'
              : 'None checked: runs for mail into every inbox, yours and those shared with you.'}
          </p>
        </Show>
      </Show>
    </div>
  );
}
