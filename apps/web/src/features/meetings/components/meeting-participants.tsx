import { Avatar, Tooltip } from '@ui';
import { For, Match, Switch } from 'solid-js';

export type MeetingParticipantsState =
  | { kind: 'loading' }
  | { kind: 'unavailable' }
  | {
      kind: 'ready';
      participants: readonly {
        displayName: string;
        avatarUrl: string | null;
      }[];
    };

/** A fixed-height preview keeps roster refreshes from moving the join controls. */
export function MeetingParticipants(props: {
  state: MeetingParticipantsState;
}) {
  const participants = () =>
    props.state.kind === 'ready' ? props.state.participants : [];
  const names = () =>
    participants()
      .map((person) => person.displayName)
      .join(', ');
  return (
    <section
      aria-label="People in this call"
      class="flex h-16 min-w-0 items-center gap-3"
      aria-live="polite"
    >
      <Switch>
        <Match when={props.state.kind === 'loading'}>
          <p class="text-sm text-ink-muted">Checking who’s here…</p>
        </Match>
        <Match when={props.state.kind === 'unavailable'}>
          <p class="text-sm text-ink-muted">
            Couldn’t load participants. You can still join.
          </p>
        </Match>
        <Match when={participants().length === 0}>
          <p class="text-sm text-ink-muted">No one else is here yet</p>
        </Match>
        <Match when={participants().length > 0}>
          <div class="flex shrink-0 -space-x-2" aria-hidden="true">
            <For each={participants().slice(0, 3)}>
              {(person) => (
                <Avatar
                  size="lg"
                  class="size-9 border-2 border-surface bg-accent-bg text-accent"
                >
                  <Avatar.Image src={person.avatarUrl ?? ''} alt="" />
                  <Avatar.Fallback>
                    {person.displayName
                      .trim()
                      .split(/\s+/)
                      .slice(0, 2)
                      .map((word) => word[0])
                      .join('')
                      .toUpperCase()}
                  </Avatar.Fallback>
                </Avatar>
              )}
            </For>
          </div>
          <div class="min-w-0">
            <p class="text-sm font-medium">
              {participants().length}{' '}
              {participants().length === 1 ? 'person' : 'people'} in this call
            </p>
            <Tooltip label={names()}>
              <p class="truncate text-sm text-ink-muted">{names()}</p>
            </Tooltip>
          </div>
        </Match>
      </Switch>
    </section>
  );
}
