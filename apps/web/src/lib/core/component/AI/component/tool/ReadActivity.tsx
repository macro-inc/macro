import { ActivityTimelineRow } from '@app/features/activity/activity-timeline-row';
import { StaticMarkdownContext } from '@core/component/LexicalMarkdown/component/core/StaticMarkdown';
import ClockCounterClockwise from '@phosphor-icons/core/regular/clock-counter-clockwise.svg';
import type { ActivityEvent } from '@queries/activity/graphql/entity';
import type { NamedTool } from '@service-cognition/generated/tools/tool';
import type { GraphqlEntityType } from '@service-storage/graphql/generated/graphql';
import { createMemo, createSignal, For } from 'solid-js';
import { match } from 'ts-pattern';
import { BaseTool } from './BaseTool';
import { Tool } from './Tool';
import { createToolRenderer } from './ToolRenderer';

type Activity = NamedTool<
  'ReadActivity',
  'response'
>['data']['activities'][number];

const ENTITY_TYPES: Readonly<Record<string, GraphqlEntityType>> = {
  user: 'USER',
  chat: 'CHAT',
  channel: 'CHANNEL',
  channel_message: 'CHANNEL_MESSAGE',
  document: 'DOCUMENT',
  project: 'PROJECT',
  email_thread: 'EMAIL_THREAD',
  calendar_event: 'CALENDAR_EVENT',
  team: 'TEAM',
  call: 'CALL',
  foreign_entity: 'FOREIGN_ENTITY',
  static_file: 'STATIC_FILE',
  crm_company: 'CRM_COMPANY',
  crm_contact: 'CRM_CONTACT',
  reminder: 'REMINDER',
  skill: 'SKILL',
  agent_session: 'AGENT_SESSION',
};

function activityAction(action: Activity['action']): ActivityEvent['action'] {
  return match(action)
    .with({ type: 'created' }, () => ({
      __typename: 'GraphqlActivityCreated' as const,
    }))
    .with({ type: 'edited' }, () => ({
      __typename: 'GraphqlActivityEdited' as const,
    }))
    .with({ type: 'opened' }, () => ({
      __typename: 'GraphqlActivityOpened' as const,
    }))
    .with({ type: 'deleted' }, () => ({
      __typename: 'GraphqlActivityDeleted' as const,
    }))
    .with({ type: 'messaged' }, () => ({
      __typename: 'GraphqlActivityMessaged' as const,
    }))
    .with({ type: 'sent' }, () => ({
      __typename: 'GraphqlActivitySent' as const,
    }))
    .with({ type: 'propertyChanged' }, ({ property, from, to }) => ({
      __typename: 'GraphqlActivityPropertyChanged' as const,
      property,
      from,
      to,
    }))
    .with({ type: 'participantAdded' }, ({ participant }) => ({
      __typename: 'GraphqlActivityParticipantAdded' as const,
      participant,
    }))
    .with({ type: 'participantRemoved' }, ({ participant }) => ({
      __typename: 'GraphqlActivityParticipantRemoved' as const,
      participant,
    }))
    .with({ type: 'callStarted' }, ({ callId }) => ({
      __typename: 'GraphqlActivityCallStarted' as const,
      callId,
    }))
    .with({ type: 'unknown' }, ({ tag, payload }) => ({
      __typename: 'GraphqlActivityUnknownAction' as const,
      tag,
      payload,
    }))
    .exhaustive();
}

function activityEvent(activity: Activity, index: number): ActivityEvent {
  return {
    __typename: 'GraphqlActivityEvent',
    id: `read-activity:${index}:${activity.occurredAt}`,
    actorId: activity.actorId,
    subjectId: activity.actorId,
    entityType: ENTITY_TYPES[activity.entityType] ?? 'FOREIGN_ENTITY',
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
                    <ActivityTimelineRow event={event} showActor={false} />
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
