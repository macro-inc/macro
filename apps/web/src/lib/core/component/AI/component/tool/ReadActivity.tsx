import ClockCounterClockwise from '@phosphor-icons/core/regular/clock-counter-clockwise.svg';
import type { NamedTool } from '@service-cognition/generated/tools/tool';
import { createSignal, For } from 'solid-js';
import { match } from 'ts-pattern';
import { BaseTool } from './BaseTool';
import { Tool } from './Tool';
import { createToolRenderer } from './ToolRenderer';

type Activity = NamedTool<
  'ReadActivity',
  'response'
>['data']['activities'][number];

function actionLabel(action: Activity['action']): string {
  return match(action)
    .with({ type: 'created' }, () => 'Created')
    .with({ type: 'edited' }, () => 'Edited')
    .with({ type: 'opened' }, () => 'Opened')
    .with({ type: 'deleted' }, () => 'Deleted')
    .with({ type: 'messaged' }, () => 'Sent a message in')
    .with({ type: 'sent' }, () => 'Sent an email in')
    .with(
      { type: 'propertyChanged' },
      ({ property }) => `Changed property ${property} on`
    )
    .with(
      { type: 'participantAdded' },
      ({ participant }) => `Added ${participant} to`
    )
    .with(
      { type: 'participantRemoved' },
      ({ participant }) => `Removed ${participant} from`
    )
    .with({ type: 'callStarted' }, () => 'Started a call in')
    .with({ type: 'unknown' }, ({ tag }) => tag.replaceAll('_', ' '))
    .exhaustive();
}

function formatRangeTimestamp(value: string): string {
  return new Date(value).toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

const handler = createToolRenderer({
  name: 'ReadActivity',
  render: (ctx) => {
    const [isExpanded, setIsExpanded] = createSignal(false);
    const activities = () => ctx.response?.data.activities ?? [];
    const hasResults = () => activities().length > 0;
    const statusText = () => {
      if (!ctx.response) return undefined;
      const count = activities().length;
      if (count === 0) return 'No Results';
      if (ctx.response.data.truncated) return `${count}+ activities`;
      if (count === 1) return '1 activity';
      return `${count} activities`;
    };

    return (
      <BaseTool
        icon={ClockCounterClockwise}
        renderContext={ctx.renderContext}
        type="call"
        response={
          hasResults() && isExpanded() ? (
            <div class="max-h-120 overflow-y-auto">
              <Tool.List>
                <For each={activities()}>
                  {(activity) => (
                    <Tool.ListItem>
                      <div class="flex min-w-0 items-center justify-between gap-3">
                        <div class="min-w-0 truncate text-ink">
                          {actionLabel(activity.action)}{' '}
                          <span class="text-ink-muted">
                            {activity.entityType} {activity.entityId}
                          </span>
                        </div>
                        <time
                          class="shrink-0 text-ink-extra-muted"
                          dateTime={activity.occurredAt}
                        >
                          {formatRangeTimestamp(activity.occurredAt)}
                        </time>
                      </div>
                    </Tool.ListItem>
                  )}
                </For>
              </Tool.List>
            </div>
          ) : undefined
        }
      >
        <div class="flex min-w-0 flex-1 items-center justify-between gap-3 overflow-hidden">
          <span class="min-w-0 truncate">
            Read activity from{' '}
            <span class="text-ink">
              {formatRangeTimestamp(ctx.tool.data.from)}
            </span>{' '}
            to{' '}
            <span class="text-ink">
              {formatRangeTimestamp(ctx.tool.data.to)}
            </span>
          </span>
          <Tool.ResultToggle
            expanded={isExpanded()}
            onToggle={() => setIsExpanded((expanded) => !expanded)}
            showToggle={hasResults()}
            status={statusText()}
          />
        </div>
      </BaseTool>
    );
  },
});

export const readActivityHandler = handler;
