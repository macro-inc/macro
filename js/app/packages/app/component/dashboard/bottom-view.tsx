import LogoIcon from '@icon/macro-logo.svg';
import { useGlobalNotificationSource } from '@app/component/GlobalAppState';
import { DashboardAiInput } from '@app/component/dashboard/dashboard-chat-input';
import { DashboardSectionBoundary } from '@app/component/dashboard/dashboard-section-boundary';
import { PromptTemplatesSection } from '@app/component/dashboard/sections/prompt-templates';
import { QUERY_FILTERS_BASE } from '@app/component/next-soup/filters/query-filters';
import { openEntityInSplitFromUnifiedList } from '@app/component/next-soup/utils';
import { globalSplitManager } from '@app/signal/splitLayout';
import { buildChatEditor } from '@core/component/AI/component/input/buildChatEditor';
import {
  EntityIcon,
  type EntityIconSelector,
} from '@core/component/EntityIcon';
import { UserIcon } from '@core/component/UserIcon';
import { useUserContext, useUserId } from '@core/context/user';
import { useDisplayName } from '@core/user/displayName';
import { tryMacroId } from '@core/user/macroId';
import { ProjectBreadCrumb } from '@entity/components/ProjectBreadCrumb';
import { PulsingStar } from '@entity/components/PulsingStar';
import {
  Entity,
  type EntityData,
  isCallEntity,
  isChannelEntity,
  isEmailEntity,
  isProjectContainedEntity,
  isTaskEntity,
} from '@entity';
import {
  getNotificationAction,
  getNotificationContent,
  getNotificationTargetName,
  notificationIsRead,
} from '@notifications';
import { useSoupItemsQuery } from '@queries/soup/items';
import { useUserTeamsQuery } from '@queries/team';
import { cognitionApiServiceClient } from '@service-cognition/client';
import { AgentModel } from '@service-cognition/generated/schemas/agentModel';
import type { PostSoupRequest } from '@service-storage/generated/schemas';
import { useQuery } from '@tanstack/solid-query';
import { createMemo, For, Match, Show, Switch } from 'solid-js';

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
  items: RelevantDashboardItem[];
};

const NIL_ID = '00000000-0000-0000-0000-000000000000';

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
  required: ['items'],
  properties: {
    items: {
      type: 'array',
      minItems: 1,
      maxItems: 8,
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
    Array.isArray(result.items) && result.items.every(isRelevantDashboardItem)
  );
}

function iconType(type: RelevantDashboardItem['type']): EntityIconSelector {
  if (type === 'email_thread') return 'email';
  if (type === 'document') return 'md';
  return type as EntityIconSelector;
}

function splitType(type: RelevantDashboardItem['type']) {
  if (type === 'email_thread') return 'email';
  if (type === 'task') return 'document';
  if (type === 'document') return 'md';
  return type;
}

function entityMatchesItem(
  entity: EntityData | undefined,
  item: RelevantDashboardItem
) {
  if (!entity || entity.id !== item.id) return false;
  if (item.type === 'email_thread') return entity.type === 'email';
  if (item.type === 'task') {
    return entity.type === 'document' && entity.subType?.type === 'task';
  }
  return entity.type === item.type;
}

function openPlaceholderItem(item: RelevantDashboardItem, event: MouseEvent) {
  const type = splitType(item.type);
  if (!item.id || !type) return;

  globalSplitManager()?.openWithSplit(
    { type: type as any, id: item.id },
    {
      activate: true,
      referredFrom: 'dashboard',
      preferNewSplit: event.shiftKey,
    }
  );
}

function PlaceholderItemRow(props: { item: RelevantDashboardItem }) {
  return (
    <button
      class="group relative flex w-full items-center gap-3 rounded-lg p-2.5 text-left transition hover:bg-active/60 hover:ring hover:ring-edge hover:ring-inset focus:outline-none focus-visible:bg-active/60 focus-visible:ring focus-visible:ring-edge focus-visible:ring-inset"
      onClick={(event) => openPlaceholderItem(props.item, event)}
    >
      <div class="flex size-8 shrink-0 items-center justify-center rounded-lg bg-hover text-ink-muted">
        <EntityIcon targetType={iconType(props.item.type)} size="sm" />
      </div>
      <div class="min-w-0 flex-1">
        <div class="truncate text-sm font-medium text-ink">
          {props.item.name}
        </div>
        <div class="mt-1 flex items-center gap-2">
          <div class="skeleton-shimmer h-2.5 w-28 rounded-full bg-ink/5" />
          <div class="skeleton-shimmer h-2.5 w-16 rounded-full bg-ink/5" />
        </div>
      </div>
    </button>
  );
}

function ChannelSecondary(props: {
  entity: Extract<EntityData, { type: 'channel' }>;
}) {
  const senderId = () => props.entity.latestMessage?.senderId;
  const senderMacroId = () => tryMacroId(senderId() ?? '');
  const [senderName] = useDisplayName(senderMacroId());

  return (
    <span class="flex min-w-0 items-center gap-1.5">
      <Show when={senderId()}>
        {(id) => (
          <UserIcon id={id()} size="sm" suppressClick showTooltip={false} />
        )}
      </Show>
      <Show when={senderName()}>
        {(name) => (
          <span class="shrink-0 font-semibold text-ink-muted">{name()}</span>
        )}
      </Show>
      <span class="min-w-0 truncate">
        {props.entity.latestMessage?.content?.trim() || 'No recent messages'}
      </span>
    </span>
  );
}

function EntitySecondary(props: { entity: EntityData }) {
  return (
    <Switch>
      <Match when={isEmailEntity(props.entity) && props.entity}>
        {(entity) => (
          <span class="flex min-w-0 items-center gap-1.5">
            <Entity.EmailParticipants entity={entity()} />
            <span class="truncate text-ink-extra-muted">
              {entity().snippet}
            </span>
          </span>
        )}
      </Match>
      <Match when={isChannelEntity(props.entity) && props.entity}>
        {(entity) => <ChannelSecondary entity={entity()} />}
      </Match>
      <Match when={isCallEntity(props.entity) && props.entity}>
        {(entity) => entity().channelName || 'Call'}
      </Match>
      <Match when={isProjectContainedEntity(props.entity) && props.entity}>
        {(entity) => <ProjectBreadCrumb entity={entity() as any} />}
      </Match>
    </Switch>
  );
}

function EntityMeta(props: { entity: EntityData }) {
  return (
    <Show when={isTaskEntity(props.entity) && props.entity}>
      {(entity) => <Entity.Properties entity={entity()} />}
    </Show>
  );
}

function RelevantHydratedRow(props: { entity: EntityData }) {
  const open = (event: MouseEvent) => {
    void openEntityInSplitFromUnifiedList(props.entity, {
      openInNewSplit: event.shiftKey,
    });
  };

  return (
    <button
      class="soup-list-entity group/narrow group relative mr-1 flex min-h-10 w-[calc(100%+1rem)] rounded-lg py-0.5 text-left transition hover:bg-active/60 hover:ring hover:ring-edge hover:ring-inset focus:outline-none focus-visible:bg-active/60 focus-visible:ring focus-visible:ring-edge focus-visible:ring-inset"
      onClick={open}
    >
      <div class="grid min-h-[inherit] w-full grid-cols-[minmax(0,1fr)_auto] grid-rows-[auto_auto_auto] items-center gap-x-2 gap-y-1 px-4 py-2 text-sm @2xl/dashboard:grid-cols-[fit-content(18rem)_minmax(0,1fr)_auto] @2xl/dashboard:grid-rows-1">
        <div class="ph-no-capture col-start-1 row-start-1 flex min-w-0 items-center gap-2 truncate font-semibold">
          <div class="size-4 shrink-0">
            <Entity.Icon entity={props.entity} />
          </div>
          <div class="min-w-0 truncate">
            <Entity.Title entity={props.entity} />
          </div>
        </div>

        <span class="col-start-2 row-start-1 justify-self-end text-xs font-medium text-ink-extra-muted @2xl/dashboard:hidden">
          <Entity.Timestamp entity={props.entity} />
        </span>

        <div class="col-span-2 col-start-1 row-start-2 min-w-0 truncate font-medium text-ink/50 @2xl/dashboard:col-span-1 @2xl/dashboard:col-start-2 @2xl/dashboard:row-start-1">
          <EntitySecondary entity={props.entity} />
        </div>

        <div class="col-span-2 col-start-1 row-start-3 flex min-w-0 items-center gap-2 overflow-hidden text-xs text-ink-muted @2xl/dashboard:col-span-1 @2xl/dashboard:col-start-3 @2xl/dashboard:row-start-1 @2xl/dashboard:justify-self-end">
          <EntityMeta entity={props.entity} />
          <span class="hidden shrink-0 text-xs font-medium text-ink-extra-muted @2xl/dashboard:inline">
            <Entity.Timestamp entity={props.entity} />
          </span>
        </div>
      </div>
    </button>
  );
}

function RelevantItemRow(props: {
  item: RelevantDashboardItem;
  entity?: EntityData;
}) {
  return (
    <Show when={props.entity}>
      {(entity) => <RelevantHydratedRow entity={entity()} />}
    </Show>
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

function buildSoupRequest(items: RelevantDashboardItem[]): PostSoupRequest {
  const documentIds: string[] = [];
  const emailThreadIds: string[] = [];
  const channelIds: string[] = [];
  const chatIds: string[] = [];
  const projectIds: string[] = [];
  const callIds: string[] = [];

  for (const item of items) {
    switch (item.type) {
      case 'document':
      case 'task':
        documentIds.push(item.id);
        break;
      case 'email_thread':
        emailThreadIds.push(item.id);
        break;
      case 'channel':
        channelIds.push(item.id);
        break;
      case 'chat':
        chatIds.push(item.id);
        break;
      case 'project':
        projectIds.push(item.id);
        break;
      case 'call':
        callIds.push(item.id);
        break;
    }
  }

  console.log(items);

  return {
    ...QUERY_FILTERS_BASE,
    limit: Math.max(items.length, 1),
    document_filters: {
      document_ids: documentIds.length ? documentIds : [NIL_ID],
    },
    email_filters: {
      email_thread_ids: emailThreadIds.length ? emailThreadIds : [NIL_ID],
    },
    channel_filters: { channel_ids: channelIds.length ? channelIds : [NIL_ID] },
    chat_filters: { chat_ids: chatIds.length ? chatIds : [NIL_ID] },
    project_filters: {
      project_ids: projectIds.length ? projectIds : [NIL_ID],
      include_root: true,
    },
    call_filters: { call_ids: callIds.length ? callIds : [NIL_ID] },
  };
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
          description: 'A list of entity-backed dashboard items relevant now.',
          schema: relevantItemsSchema,
        },
        prompt: `You are selecting entity-backed items for a dashboard list.

Use tools as needed to inspect recent workspace activity and search/list real entities. Return only real entities with ids that can be opened in the app. Do not invent ids.

Return only each entity's type, id, and current display name. Do not summarize or explain each item; the UI will fetch details separately.

If hasTeam is true, choose items likely relevant to the user from recent team activity and/or important team work. If hasTeam is false, choose items the current user recently interacted with plus items they may need to address based on notifications.

Return 6-8 items when possible.

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

  const aiItems = createMemo(() => resultQuery.data?.items ?? []);
  const soupQuery = useSoupItemsQuery(
    () => ({
      params: {
        limit: Math.max(aiItems().length, 1),
        sort_method: 'updated_at',
      },
      body: buildSoupRequest(aiItems()),
    }),
    () => ({ enabled: aiItems().length > 0 })
  );

  const entityById = createMemo(() => {
    const map = new Map<string, EntityData>();
    for (const entity of soupQuery.data ?? []) map.set(entity.id, entity);
    return map;
  });

  return (
    <Show when={!resultQuery.isLoading} fallback={<RelevantItemsSkeleton />}>
      <div class="flex w-full flex-col gap-1 px-4 sm:px-0">
        <For each={aiItems()}>
          {(item) => (
            <RelevantItemRow
              item={item}
              entity={
                entityMatchesItem(entityById().get(item.id), item)
                  ? entityById().get(item.id)
                  : undefined
              }
            />
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
  const fillChatInput = (
    text: string,
    mode: 'replace' | 'append' = 'replace'
  ) => {
    if (mode === 'append') {
      const current = chatEditor.controls.getMarkdown().trimEnd();
      if (!current.includes(text)) {
        chatEditor.controls.setMarkdown(
          current ? `${current}\n\n${text}` : text
        );
      }
    } else {
      chatEditor.controls.setMarkdown(text);
    }
    chatEditor.controls.focus();
  };

  return (
    <div class="flex min-h-full w-full flex-col justify-between gap-8">
      <div class="flex flex-col w-full flex-1 flex-col gap-6">
        <div class="flex gap-4">
          <LogoIcon class="hidden @max-sm:hidden sm:size-8 self-center text-accent sm:block" />
          <h1 class="text-balance text-2xl font-semibold tracking-tight text-ink">
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
        <DashboardSectionBoundary title="prompt templates">
          <PromptTemplatesSection onSelect={fillChatInput} />
        </DashboardSectionBoundary>

        <DashboardSectionBoundary title="hero">
          <DashboardAiInput editor={chatEditor} />
        </DashboardSectionBoundary>
      </div>
    </div>
  );
}
