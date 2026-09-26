import { UserIcon } from '@core/component/UserIcon';
import { getDisplayName, tryMacroId } from '@core/user';
import { type DateValue, formatDate } from '@core/util/date';
import ClockIcon from '@phosphor/clock.svg';
import { type ParentProps, Show } from 'solid-js';
import { SidePanel } from './SidePanel';

/** Shared owner and timestamps presentation for task and project details. */
export function EntityDetailsGrid(
  props: ParentProps<{
    ownerId?: string;
    createdAt?: DateValue | null;
    updatedAt?: DateValue | null;
  }>
) {
  return (
    <SidePanel.Grid>
      <Show when={props.ownerId}>
        {(owner) => (
          <SidePanel.Row label="Owner">
            <SidePanel.Pill>
              <UserIcon id={owner()} size="sm" showTooltip suppressClick />
              <span class="truncate">
                {getDisplayName(tryMacroId(owner()))}
              </span>
            </SidePanel.Pill>
          </SidePanel.Row>
        )}
      </Show>
      {props.children}
      <Show when={props.createdAt}>
        {(created) => (
          <SidePanel.Row label="Created">
            <DateValueDisplay value={created()} />
          </SidePanel.Row>
        )}
      </Show>
      <Show when={props.updatedAt}>
        {(updated) => (
          <SidePanel.Row label="Last updated">
            <DateValueDisplay value={updated()} />
          </SidePanel.Row>
        )}
      </Show>
    </SidePanel.Grid>
  );
}

function DateValueDisplay(props: { value: DateValue }) {
  return (
    <SidePanel.Pill>
      <ClockIcon class="size-3 shrink-0" />
      <span class="truncate">
        {formatDate(props.value, { showTime: true })}
      </span>
    </SidePanel.Pill>
  );
}
