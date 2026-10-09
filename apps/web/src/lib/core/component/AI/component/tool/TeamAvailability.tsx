import { getDisplayName, tryMacroId } from '@core/user';
import CalendarCheck from '@phosphor-icons/core/regular/calendar-check.svg';
import type { NamedTool } from '@service-cognition/generated/tools/tool';
import { format } from 'date-fns';
import { For, Show } from 'solid-js';
import { BaseTool } from './BaseTool';
import { Tool } from './Tool';
import { createToolRenderer } from './ToolRenderer';

type Availability = NamedTool<'GetTeamAvailability', 'response'>['data'];

function AvailabilityResponse(props: { data: Availability }) {
  return (
    <Tool.List>
      <For each={props.data.members}>
        {(member) => (
          <Tool.ListItem>
            <span class="min-w-0 flex-1 truncate text-xs text-ink">
              {getDisplayName(tryMacroId(member.userId)) || 'Teammate'}
            </span>
            <span class="text-xs text-ink-muted">
              {member.coverage === 'unknown'
                ? 'Availability unknown'
                : `${member.busy.length} busy blocks`}
            </span>
          </Tool.ListItem>
        )}
      </For>
      <Show when={!props.data.complete}>
        <Tool.ListItem>
          Some availability is unknown. No shared free time can be confirmed.
        </Tool.ListItem>
      </Show>
      <Show
        when={props.data.complete && (props.data.freeWindows?.length ?? 0) > 0}
      >
        <Tool.ListItem>Free for everyone checked, including you</Tool.ListItem>
        <For each={props.data.freeWindows}>
          {(window) => (
            <Tool.ListItem>
              {format(new Date(window.start), 'EEE MMM d, h:mm a')} –{' '}
              {format(new Date(window.end), 'EEE MMM d, h:mm a')}
            </Tool.ListItem>
          )}
        </For>
      </Show>
      <Show when={props.data.complete && props.data.freeWindows?.length === 0}>
        <Tool.ListItem>No shared free time in this window.</Tool.ListItem>
      </Show>
    </Tool.List>
  );
}

export const getTeamAvailabilityHandler = createToolRenderer({
  name: 'GetTeamAvailability',
  render: (ctx) => (
    <BaseTool
      icon={CalendarCheck}
      renderContext={ctx.renderContext}
      type="call"
      response={
        ctx.response?.data ? (
          <AvailabilityResponse data={ctx.response.data} />
        ) : undefined
      }
    >
      Check team availability
    </BaseTool>
  ),
});
