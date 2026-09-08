import type {
  ActivityAction,
  ActivityEntityType,
  ActivityEvent,
} from '@app/features/activity/core/event';
import { openEntityInSplit } from '@app/features/activity/open-entity-in-split';
import { ActivityTimelineRow } from '@app/features/activity/views/activity-timeline-row';
import { StaticMarkdownContext } from '@core/component/LexicalMarkdown/component/core/StaticMarkdown';
import ClockCounterClockwise from '@phosphor-icons/core/regular/clock-counter-clockwise.svg';
import type { NamedTool } from '@service-cognition/generated/tools/tool';
import { createMemo, createSignal, For } from 'solid-js';
import { match } from 'ts-pattern';
import { BaseTool } from './BaseTool';
import { Tool } from './Tool';
import { createToolRenderer } from './ToolRenderer';

type Activity = NamedTool<
  'ReadActivity',
  'response'
>['data']['activities'][number];

function decodeToolEntityType(raw: string): ActivityEntityType {
  return match(raw)
    .with('document', () => 'document' as const)
    .with('project', () => 'project' as const)
    .with('chat', () => 'chat' as const)
    .with('email_thread', () => 'email-thread' as const)
    .with('channel', () => 'channel' as const)
    .with('user', () => 'user' as const)
    .otherwise((value) => ({ kind: 'unsupported' as const, raw: value }));
}

function activityAction(action: Activity['action']): ActivityAction {
  return match(action)
    .with({ type: 'created' }, () => ({
      kind: 'created' as const,
    }))
    .with({ type: 'edited' }, () => ({
      kind: 'edited' as const,
    }))
    .with({ type: 'opened' }, () => ({
      kind: 'opened' as const,
    }))
    .with({ type: 'deleted' }, () => ({
      kind: 'deleted' as const,
    }))
    .with({ type: 'messaged' }, () => ({
      kind: 'messaged' as const,
    }))
    .with({ type: 'sent' }, () => ({
      kind: 'email-sent' as const,
    }))
    .with({ type: 'propertyChanged' }, ({ property, from, to }) => ({
      kind: 'property-changed' as const,
      property,
      from,
      to,
    }))
    .with({ type: 'participantAdded' }, ({ participant }) => ({
      kind: 'participant-added' as const,
      participant,
    }))
    .with({ type: 'participantRemoved' }, ({ participant }) => ({
      kind: 'participant-removed' as const,
      participant,
    }))
    .with({ type: 'callStarted' }, () => ({
      kind: 'call-started' as const,
    }))
    .with({ type: 'unknown' }, ({ tag }) => ({
      kind: 'unknown' as const,
      tag,
    }))
    .exhaustive();
}

function activityEvent(activity: Activity, index: number): ActivityEvent {
  return {
    id: `read-activity:${index}:${activity.occurredAt}`,
    actorId: activity.actorId,
    entityType: decodeToolEntityType(activity.entityType),
    entityId: activity.entityId,
    action: activityAction(activity.action),
    occurredAt: activity.occurredAt,
  };
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
    const [isExpanded, setIsExpanded] = createSignal(
      ctx.renderContext.grouped !== true
    );
    const activities = () => ctx.response?.data.activities ?? [];
    const events = createMemo(() => activities().map(activityEvent));
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
            <StaticMarkdownContext>
              <div class="max-h-120 overflow-y-auto rounded-md border border-edge-muted/60 py-1">
                <For each={events()}>
                  {(event) => (
                    <ActivityTimelineRow
                      event={event}
                      showActor={false}
                      onOpen={openEntityInSplit}
                    />
                  )}
                </For>
              </div>
            </StaticMarkdownContext>
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
