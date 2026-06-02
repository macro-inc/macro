import { DashboardAiInput } from '@app/component/dashboard/dashboard-chat-input';
import { DashboardSectionBoundary } from '@app/component/dashboard/dashboard-section-boundary';
import { QuickActionsSection } from '@app/component/dashboard/sections/quick-actions';
import { useGlobalNotificationSource } from '@app/component/GlobalAppState';
import { buildChatEditor } from '@core/component/AI/component/input/buildChatEditor';
import { ItemPreview } from '@core/component/ItemPreview';
import { useUserContext, useUserId } from '@core/context/user';
import { PulsingStar } from '@entity/components/PulsingStar';
import LogoIcon from '@icon/macro-logo.svg';
import {
  getNotificationAction,
  getNotificationContent,
  getNotificationTargetName,
  notificationIsRead,
} from '@notifications';
import WarningIcon from '@phosphor/warning.svg';
import { useUserTeamsQuery } from '@queries/team';
import { cognitionApiServiceClient } from '@service-cognition/client';
import { AgentModel } from '@service-cognition/generated/schemas/agentModel';
import { useQuery } from '@tanstack/solid-query';
import { createMemo, For, Show } from 'solid-js';

type RelevantDashboardItem = {
  id: string;
  type:
    | 'channel'
    | 'email_thread'
    | 'task'
    | 'document'
    | 'project'
    | 'chat'
    | 'call';
  name: string;
};

type RelevantDashboardItems = {
  actionItems: RelevantDashboardItem[];
  suggestedItems: RelevantDashboardItem[];
};

const relevantItemSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['id', 'type', 'name'],
  properties: {
    id: { type: 'string' },
    type: {
      type: 'string',
      enum: [
        'channel',
        'email_thread',
        'task',
        'document',
        'project',
        'chat',
        'call',
      ],
    },
    name: { type: 'string' },
  },
};

const relevantItemsSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['actionItems', 'suggestedItems'],
  properties: {
    actionItems: {
      type: 'array',
      minItems: 0,
      maxItems: 5,
      items: relevantItemSchema,
    },
    suggestedItems: {
      type: 'array',
      minItems: 0,
      maxItems: 5,
      items: relevantItemSchema,
    },
  },
};

function isRelevantDashboardItem(
  value: unknown
): value is RelevantDashboardItem {
  if (!value || typeof value !== 'object') return false;
  const item = value as Partial<RelevantDashboardItem>;
  return (
    typeof item.id === 'string' &&
    typeof item.type === 'string' &&
    typeof item.name === 'string'
  );
}

function isRelevantDashboardItems(
  value: unknown
): value is RelevantDashboardItems {
  if (!value || typeof value !== 'object') return false;
  const result = value as Partial<RelevantDashboardItems>;
  return (
    Array.isArray(result.actionItems) &&
    result.actionItems.every(isRelevantDashboardItem) &&
    Array.isArray(result.suggestedItems) &&
    result.suggestedItems.every(isRelevantDashboardItem)
  );
}

function previewType(type: RelevantDashboardItem['type']) {
  if (type === 'email_thread') return 'email';
  if (type === 'task') return 'document';
  return type;
}

function RelevantItemRow(props: {
  item: RelevantDashboardItem;
  attention?: boolean;
}) {
  return (
    <div class="flex w-full items-center gap-2">
      <Show when={props.attention}>
        <WarningIcon class="size-3.5 shrink-0 text-alert-ink" />
      </Show>
      <ItemPreview
        id={props.item.id}
        type={previewType(props.item.type) as any}
        disableHoverCard
        class="group relative mr-1 flex h-auto min-h-10 min-w-0 flex-1 justify-start rounded-lg border-0 bg-transparent px-4 py-2 text-left ring-0 transition hover:bg-active/60 hover:ring hover:ring-edge hover:ring-inset focus:outline-none focus-visible:bg-active/60 focus-visible:ring focus-visible:ring-edge focus-visible:ring-inset"
        iconClass="size-4 shrink-0"
        textClass="min-w-0 truncate text-sm font-semibold text-ink"
        maxLength={120}
      />
    </div>
  );
}

function RelevantItemsSkeleton() {
  return (
    <div class="w-full px-4 sm:px-0">
      <div class="skeleton-shimmer rounded-xl bg-hover/50 p-3">
        <div class="flex items-start gap-2">
          <PulsingStar kind="streamIndicator" animate />
          <div class="min-w-0 flex-1">
            <div class="skeleton-shimmer mb-3 h-3 w-2/3 rounded-full bg-ink/10" />
            <div class="space-y-2">
              <div class="skeleton-shimmer h-2.5 w-full rounded-full bg-ink/5" />
              <div class="skeleton-shimmer h-2.5 w-4/5 rounded-full bg-ink/5" />
            </div>
          </div>
        </div>
      </div>
      <div class="mt-3 flex flex-col gap-2">
        <For each={[0, 1, 2, 3]}>
          {() => (
            <div class="skeleton-shimmer h-14 rounded-xl bg-hover/60 p-2.5">
              <div class="flex items-center gap-3">
                <div class="skeleton-shimmer size-8 rounded-lg bg-surface" />
                <div class="min-w-0 flex-1 space-y-2">
                  <div class="skeleton-shimmer h-3 w-3/5 rounded-full bg-ink/10" />
                  <div class="skeleton-shimmer h-2.5 w-2/5 rounded-full bg-ink/5" />
                </div>
              </div>
            </div>
          )}
        </For>
      </div>
    </div>
  );
}

function RelevantItemsList() {
  const userId = useUserId();
  const userTeamsQuery = useUserTeamsQuery();
  const notificationSource = useGlobalNotificationSource();

  const hasTeam = createMemo(() => (userTeamsQuery.data?.length ?? 0) > 0);
  const promptContext = createMemo(() => {
    const notifications = notificationSource
      .notifications()
      .filter((notification) => !notification.done)
      .sort(
        (a, b) =>
          Number(!notificationIsRead(b)) - Number(!notificationIsRead(a)) ||
          new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      )
      .slice(0, 24)
      .map((notification) => ({
        id: notification.entity_id,
        type:
          notification.notification_metadata.tag === 'task_assigned'
            ? 'task'
            : notification.entity_type === 'email_thread'
              ? 'email_thread'
              : notification.entity_type,
        name:
          getNotificationTargetName(notification) ||
          getNotificationContent(notification) ||
          notification.entity_type,
        action: getNotificationAction(notification),
        content: getNotificationContent(notification),
        unread: !notificationIsRead(notification),
        createdAt: notification.created_at,
      }));

    return JSON.stringify({
      currentUserId: userId(),
      hasTeam: hasTeam(),
      selectionGoal: hasTeam()
        ? 'team_relevant_recent_or_important_items'
        : 'personal_recent_and_needs_attention_items',
      notifications,
    });
  });

  const resultQuery = useQuery(() => ({
    queryKey: ['dashboard', 'relevant-items', promptContext()],
    queryFn: async () => {
      const context = promptContext();
      const response = await cognitionApiServiceClient.structuredCompletion({
        model: AgentModel.fast,
        toolset: { type: 'all' },
        output_schema: {
          name: 'DashboardRelevantItems',
          description:
            'Entity-backed dashboard action items and suggested review items.',
          schema: relevantItemsSchema,
        },
        prompt: `You are selecting entity-backed items for a dashboard list.

Use tools as needed to inspect recent workspace activity and search/list real entities. Return only real entities with ids that can be opened in the app. Do not invent ids.

Return two sets:
- actionItems: items that require the current user's attention or action now. Prioritize assigned tasks, direct mentions, unread/urgent notifications, unanswered questions, requested reviews/approvals, emails needing replies, call action items, and blocked work waiting on the current user.
- suggestedItems: items that are useful suggestions for the current user to review or follow up on, but are less urgent or not clearly assigned. Include recent team work, active projects, relevant channels/chats, important documents, calls, or email threads worth checking.

Return only each entity's type, id, and current display name. Do not summarize or explain each item; the UI will fetch details separately.

If hasTeam is true, use recent team activity and important team work to select both sets. If hasTeam is false, use the current user's recent interactions and notifications.

Avoid duplicates between actionItems and suggestedItems. Prefer actionItems when an item clearly needs the current user's attention. Return up to 3-5 items in each set when possible. Empty arrays are allowed when there is not enough evidence.

JSON context:\n${context}`,
      });

      if (response.isErr()) throw new Error('Failed to load relevant items');
      if (!isRelevantDashboardItems(response.value.result)) {
        throw new Error('Invalid relevant items response');
      }
      return response.value.result;
    },
    staleTime: Infinity,
  }));

  const actionItems = createMemo(() => resultQuery.data?.actionItems ?? []);
  const suggestedItems = createMemo(
    () => resultQuery.data?.suggestedItems ?? []
  );
  const groupedItems = createMemo(() => [
    ...actionItems().map((item) => ({ item, attention: true })),
    ...suggestedItems().map((item) => ({ item, attention: false })),
  ]);

  return (
    <Show when={!resultQuery.isLoading} fallback={<RelevantItemsSkeleton />}>
      <div class="flex w-full flex-col gap-1 px-4 sm:px-0">
        <For each={groupedItems()}>
          {({ item, attention }) => (
            <RelevantItemRow item={item} attention={attention} />
          )}
        </For>
      </div>
    </Show>
  );
}

export function BottomView() {
  const user = useUserContext();
  const firstName = createMemo(() => {
    const name = user.author();
    return name.includes('@') ? name.split('@')[0] : name.split(' ')[0];
  });
  const timeOfDay = createMemo(() => {
    const hour = new Date().getHours();
    if (hour < 12) return 'morning';
    if (hour < 18) return 'afternoon';
    return 'evening';
  });
  const greeting = createMemo(() => `Good ${timeOfDay()}`);
  const chatEditor = buildChatEditor();
  return (
    <div class="max-w-4xl mx-auto flex min-h-full w-full flex-col justify-between gap-8">
      <div class="flex flex-col w-full flex-1 flex-col gap-6">
        <div class="flex gap-2">
          <LogoIcon class="hidden @max-sm:hidden sm:size-6 self-center text-accent sm:block" />
          <h1 class="text-balance text-xl font-semibold tracking-tight text-ink">
            {greeting()}, <span class="capitalize">{firstName()}.</span>
          </h1>
        </div>
        <div class="-ml-4">
          <DashboardSectionBoundary title="relevant items">
            <RelevantItemsList />
          </DashboardSectionBoundary>
        </div>
      </div>

      <div class="mx-auto flex w-full flex-col gap-3 px-4 sm:px-0">
        <DashboardSectionBoundary title="quick actions">
          <QuickActionsSection />
        </DashboardSectionBoundary>

        <DashboardSectionBoundary title="hero">
          <DashboardAiInput editor={chatEditor} />
        </DashboardSectionBoundary>
      </div>
    </div>
  );
}
