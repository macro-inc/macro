import { Checkbox, ToggleSwitch } from '@ui';
import { For, Show } from 'solid-js';
import {
  type CalendarTeamMemberDisplay,
  canShowTeamMember,
  teamMemberStatus,
} from '../core/model';

export function TeamCalendarControls(props: {
  enabled: boolean;
  onEnabledChange: (enabled: boolean) => void;
  members: CalendarTeamMemberDisplay[];
  loading: boolean;
  error: boolean;
  onRetry: () => void;
  isVisible: (sourceId: string) => boolean;
  onVisibilityChange: (sourceId: string, visible: boolean) => void;
}) {
  return (
    <div class="flex flex-col gap-2">
      <div class="flex items-center justify-between gap-3 px-2 text-xs text-ink">
        Show team calendars
        <ToggleSwitch
          checked={props.enabled}
          onChange={props.onEnabledChange}
          label="Show team calendars"
          labelClass="sr-only"
        />
      </div>
      <p class="px-2 text-xs text-ink-muted">
        Shared event details can include calendars a teammate follows. Those
        events do not necessarily mean they are busy.
      </p>
      <Show when={props.loading}>
        <p role="status" class="px-2 text-xs text-ink-muted">
          Loading team calendars…
        </p>
      </Show>
      <Show when={props.error}>
        <div role="status" class="px-2 text-xs text-ink-muted">
          Team calendars unavailable.{' '}
          <button type="button" class="underline" onClick={props.onRetry}>
            Retry
          </button>
        </div>
      </Show>
      <For each={props.members}>
        {(member) => (
          <Checkbox
            checked={
              canShowTeamMember(member) && props.isVisible(member.sourceId)
            }
            disabled={!props.enabled || !canShowTeamMember(member)}
            onChange={(visible) =>
              props.onVisibilityChange(member.sourceId, visible)
            }
            class="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-xs text-ink hover:bg-hover data-disabled:opacity-60"
          >
            <Checkbox.Control />
            <Checkbox.Label class="flex min-w-0 flex-1 items-center gap-2">
              <span
                aria-hidden="true"
                class="size-2.5 shrink-0 rounded-sm"
                style={{ 'background-color': member.color }}
              />
              <span class="min-w-0 flex-1 truncate" title={member.name}>
                {member.name}
              </span>
              <span class="shrink-0 text-ink-muted">
                {teamMemberStatus(member)}
              </span>
            </Checkbox.Label>
          </Checkbox>
        )}
      </For>
    </div>
  );
}
