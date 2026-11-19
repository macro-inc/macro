import { ListSkeleton } from '@app/components/view-shell/ListSkeleton';
import { Checkbox } from '@ui';
import { type Accessor, For, Match, Show, Switch } from 'solid-js';
import { MAX_INBOXES } from '../core/routine-triggers';

/** One inbox the routine's owner reads. */
export type InboxChoice = {
  id: string;
  address: string;
  /** Someone else's inbox, shared with the owner. */
  shared: boolean;
};

/** The owner's inboxes, or why they aren't listed yet. */
export type InboxChoices =
  | { state: 'pending' }
  | { state: 'failed' }
  | { state: 'ready'; inboxes: InboxChoice[] };

/** "team@example.com" or "2 inboxes": what an inbox filter picked. */
export function pickedInboxesLabel(picked: string[], choices: InboxChoices) {
  if (picked.length > 1) return `${picked.length} inboxes`;
  if (choices.state !== 'ready') return '1 inbox';
  const inbox = choices.inboxes.find((item) => item.id === picked[0]);
  return inbox?.address ?? 'A disconnected inbox';
}

const ROW =
  'flex min-h-8 items-center gap-2 rounded-md px-2 py-1 not-touch:hover:bg-hover touch:min-h-11';

/**
 * The owner's inboxes to check. None checked watches every one; an inbox
 * picked before it was disconnected stays listed so it can be unchecked.
 */
export function RoutineInboxPicker(props: {
  choices: InboxChoices;
  picked: Accessor<string[]>;
  onChange: (inboxes: string[]) => void;
}) {
  const ready = () =>
    props.choices.state === 'ready' ? props.choices.inboxes : undefined;
  const missing = (inboxes: InboxChoice[]) =>
    props.picked().filter((id) => !inboxes.some((inbox) => inbox.id === id));
  const checked = (id: string) => props.picked().includes(id);
  const toggle = (id: string, on: boolean) =>
    props.onChange(
      on
        ? [...props.picked(), id]
        : props.picked().filter((inbox) => inbox !== id)
    );
  return (
    <div class="grid gap-1.5">
      <span class="text-xs font-medium">Inboxes</span>
      <Switch>
        <Match when={props.choices.state === 'pending'}>
          <div
            class="grid gap-2.5 rounded-lg border border-edge-muted p-2.5"
            role="status"
            aria-label="Loading inboxes"
          >
            <ListSkeleton.Bar class="h-3 w-3/5" />
            <ListSkeleton.Bar class="h-3 w-2/5" />
          </div>
        </Match>
        <Match when={props.choices.state === 'failed'}>
          <p class="text-xs text-failure">Your inboxes couldn’t be listed.</p>
        </Match>
        <Match when={ready()}>
          {(inboxes) => (
            <Show
              when={inboxes().length > 0 || props.picked().length > 0}
              fallback={
                <p class="text-xs text-ink-muted">
                  You have no inboxes connected.
                </p>
              }
            >
              <div class="grid max-h-64 gap-0.5 overflow-y-auto overscroll-contain rounded-lg border border-edge-muted p-1">
                <For each={inboxes()}>
                  {(inbox) => (
                    <Checkbox
                      class={ROW}
                      checked={checked(inbox.id)}
                      disabled={
                        !checked(inbox.id) &&
                        props.picked().length >= MAX_INBOXES
                      }
                      onChange={(on) => toggle(inbox.id, on)}
                    >
                      <Checkbox.Control />
                      <Checkbox.Label class="flex min-w-0 flex-col text-sm font-normal">
                        <span class="truncate">{inbox.address}</span>
                        <Show when={inbox.shared}>
                          <span class="text-xs text-ink-muted">
                            Shared with you
                          </span>
                        </Show>
                      </Checkbox.Label>
                    </Checkbox>
                  )}
                </For>
                <For each={missing(inboxes())}>
                  {(id) => (
                    <Checkbox
                      class={ROW}
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
                {props.picked().length
                  ? 'Runs only for mail into the inboxes checked.'
                  : 'None checked: runs for mail into every inbox, yours and those shared with you.'}
              </p>
            </Show>
          )}
        </Match>
      </Switch>
    </div>
  );
}
