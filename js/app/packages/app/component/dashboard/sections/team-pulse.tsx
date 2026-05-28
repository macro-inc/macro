import { useGlobalNotificationSource } from '@app/component/GlobalAppState';
import { AdaptiveScroller } from '@app/component/dashboard/adaptive-scroller';
import { DashboardSectionError } from '@app/component/dashboard/dashboard-section-error';
import { globalSplitManager } from '@app/signal/splitLayout';
import { EntityIcon, type EntityIconSelector } from '@core/component/EntityIcon';
import { useSettingsState } from '@core/constant/SettingsState';
import { useUserId } from '@core/context/user';
import {
  getNotificationAction,
  getNotificationContent,
  getNotificationTargetName,
  notificationIsRead,
} from '@notifications';
import { useAutomationEntities } from '@queries/agent-schedule/entities';
import { useTeamQuery, useUserTeamsQuery } from '@queries/team';
import { cognitionApiServiceClient } from '@service-cognition/client';
import { AgentModel } from '@service-cognition/generated/schemas/agentModel';
import { TeamRole } from '@service-auth/generated/schemas/teamRole';
import RefreshIcon from '@phosphor/arrow-clockwise.svg';
import ArrowRightIcon from '@phosphor/arrow-right.svg';
import { PulsingStar } from '@entity/components/PulsingStar';
import { AnimatedStarIcon } from '@icon/wide-star';
import { Button, HoverCard } from '@ui';
import {
  type Accessor,
  createMemo,
  createResource,
  createSignal,
  ErrorBoundary,
  For,
  Match,
  Show,
  Suspense,
  Switch,
} from 'solid-js';

type PulseEntity = {
  id: string;
  type: string;
  label: string;
  reason: string;
  category: 'working_on' | 'needs_attention' | 'recent_signal';
};

type TeamPulse = {
  overview: string;
  health: string;
  entities: PulseEntity[];
};

type TeamPulseResourceSource = {
  context: string;
  refreshToken: number;
};

const TEAM_PULSE_CACHE_PREFIX = 'dashboard:team-pulse:entity-first:v2:';
const TEAM_PULSE_CACHE_TTL_MS = 10 * 60 * 1000;

const pulseEntitySchema = {
  type: 'object',
  additionalProperties: false,
  required: ['id', 'type', 'label', 'reason', 'category'],
  properties: {
    id: { type: 'string' },
    type: {
      type: 'string',
      enum: [
        'channel',
        'email',
        'task',
        'document',
        'project',
        'chat',
        'automation',
        'call',
      ],
    },
    label: { type: 'string' },
    reason: { type: 'string' },
    category: {
      type: 'string',
      enum: ['working_on', 'needs_attention', 'recent_signal'],
    },
  },
};

const teamPulseSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['overview', 'health', 'entities'],
  properties: {
    overview: { type: 'string' },
    health: { type: 'string' },
    entities: {
      type: 'array',
      minItems: 1,
      maxItems: 8,
      items: pulseEntitySchema,
    },
  },
};

function hashString(value: string) {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash * 31 + value.charCodeAt(i)) | 0;
  }
  return Math.abs(hash).toString(36);
}

function cacheKey(context: string) {
  return `${TEAM_PULSE_CACHE_PREFIX}${hashString(context)}`;
}

function isPulseEntity(value: unknown): value is PulseEntity {
  if (!value || typeof value !== 'object') return false;
  const entity = value as Partial<PulseEntity>;
  return (
    typeof entity.id === 'string' &&
    typeof entity.type === 'string' &&
    typeof entity.label === 'string' &&
    typeof entity.reason === 'string' &&
    (entity.category === 'working_on' ||
      entity.category === 'needs_attention' ||
      entity.category === 'recent_signal')
  );
}

function isTeamPulse(value: unknown): value is TeamPulse {
  if (!value || typeof value !== 'object') return false;
  const pulse = value as Partial<TeamPulse>;
  return (
    typeof pulse.overview === 'string' &&
    typeof pulse.health === 'string' &&
    Array.isArray(pulse.entities) &&
    pulse.entities.every(isPulseEntity)
  );
}

function readCachedPulse(context: string): TeamPulse | undefined {
  try {
    const raw = localStorage.getItem(cacheKey(context));
    if (!raw) return undefined;
    const parsed = JSON.parse(raw) as { createdAt: number; data: unknown };
    if (Date.now() - parsed.createdAt > TEAM_PULSE_CACHE_TTL_MS) {
      localStorage.removeItem(cacheKey(context));
      return undefined;
    }
    return isTeamPulse(parsed.data) ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}

function writeCachedPulse(context: string, data: TeamPulse) {
  try {
    localStorage.setItem(
      cacheKey(context),
      JSON.stringify({ createdAt: Date.now(), data })
    );
  } catch {
    // Ignore storage failures; the generated pulse can still render.
  }
}

function iconType(type: string): EntityIconSelector {
  if (type === 'email_thread') return 'email';
  if (type === 'channel_message') return 'channel';
  if (type === 'folder') return 'project';
  if (type === 'document') return 'md';
  return type as EntityIconSelector;
}

function splitType(type: string) {
  if (type === 'email_thread') return 'email';
  if (type === 'channel_message') return 'channel';
  if (type === 'folder') return 'project';
  if (type === 'task') return 'document';
  if (type === 'document') return 'md';
  return type;
}

function categoryLabel(category: PulseEntity['category']) {
  switch (category) {
    case 'working_on':
      return 'Working on';
    case 'needs_attention':
      return 'Needs attention';
    case 'recent_signal':
      return 'Recent signal';
  }
}

function openPulseEntity(entity: PulseEntity, event: MouseEvent) {
  const type = splitType(entity.type);
  if (!entity.id || !type) return;

  globalSplitManager()?.openWithSplit(
    { type: type as any, id: entity.id },
    {
      activate: true,
      referredFrom: 'dashboard',
      preferNewSplit: event.shiftKey,
    }
  );
}

function PulseEntityRow(props: { entity: PulseEntity }) {
  return (
    <button
      class="group flex min-h-24 w-64 shrink-0 snap-start flex-col justify-between rounded-xl border border-edge-muted p-3 text-left transition hover:bg-active/60 hover:ring hover:ring-edge hover:ring-inset focus:outline-none focus-visible:bg-active/60 focus-visible:ring focus-visible:ring-edge focus-visible:ring-inset @3xl/dashboard:w-auto @3xl/dashboard:min-w-0"
      onClick={(event) => openPulseEntity(props.entity, event)}
    >
      <div class="flex w-full items-center justify-between gap-2">
        <span class="inline-flex w-fit max-w-[calc(100%-1.5rem)] items-center gap-1.5 rounded-md bg-hover px-1.5 py-0.5 text-xxs font-semibold text-ink-muted">
          <span class="size-3.5 shrink-0">
            <EntityIcon targetType={iconType(props.entity.type)} size="fill" />
          </span>
          <span class="truncate">{categoryLabel(props.entity.category)}</span>
        </span>
        <ArrowRightIcon class="size-4 shrink-0 text-ink-extra-muted opacity-0 transition group-hover:translate-x-0.5 group-hover:opacity-100" />
      </div>
      <div class="mt-3 min-w-0">
        <p class="truncate text-sm font-semibold text-ink">
          {props.entity.label}
        </p>
        <HoverCard
          placement="top"
          contentClass="max-w-80 items-start text-left leading-5"
          content={<p>{props.entity.reason}</p>}
        >
          <span
            class="mt-1 inline-flex rounded-md text-xxs text-ink-extra-muted underline decoration-current/20 underline-offset-2 opacity-0 transition hover:text-ink-muted group-hover:opacity-100"
            onClick={(event) => event.stopPropagation()}
          >
            Details
          </span>
        </HoverCard>
      </div>
    </button>
  );
}

function TeamPulseSkeleton() {
  return (
    <div>
      <div class="px-4 sm:px-0">
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
      </div>
      <div class="mt-3 flex snap-x scroll-pl-4 gap-2 overflow-x-auto px-4 pb-1 scrollbar-hidden sm:px-0 @3xl/dashboard:grid @3xl/dashboard:grid-cols-2 @3xl/dashboard:overflow-visible @3xl/dashboard:pb-0 @6xl/dashboard:grid-cols-4">
        <For each={[0, 1, 2, 3]}>
          {() => (
            <div class="skeleton-shimmer h-24 w-64 shrink-0 snap-start rounded-xl border border-edge-muted p-3 @3xl/dashboard:w-auto">
              <div class="mb-4 flex items-center justify-between gap-2">
                <div class="skeleton-shimmer h-5 w-24 rounded-md bg-hover" />
                <div class="skeleton-shimmer size-4 rounded bg-ink/5" />
              </div>
              <div class="skeleton-shimmer h-3 w-2/3 rounded-full bg-ink/10" />
            </div>
          )}
        </For>
      </div>
    </div>
  );
}

function TeamPulseContent(props: { refreshToken: Accessor<number> }) {
  const userTeamsQuery = useUserTeamsQuery();
  const notificationSource = useGlobalNotificationSource();
  const automations = useAutomationEntities();
  const userId = useUserId();

  const firstTeam = createMemo(() => userTeamsQuery.data?.[0]);
  const teamQuery = useTeamQuery(() => firstTeam()?.id ?? '');

  const promptContext = createMemo(() => {
    const team = firstTeam();
    if (!team || !teamQuery.data) return undefined;

    const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

    const notificationSignals = notificationSource
      .notifications()
      .filter((notification) => !notification.done)
      .filter((notification) => notification.created_at >= since)
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
              ? 'email'
              : notification.entity_type === 'channel_message'
                ? 'channel'
                : notification.entity_type,
        label:
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
      perspective: 'entire_team_not_current_user',
      timeframe: { label: 'last_7_days', since },
      team: { name: team.name, slug: team.slug },
      members: teamQuery.data.members.map((member) => ({
        id: member.user_id,
        type: 'user',
        label: member.user_id,
        role: member.role,
      })),
      availableEntities: [
        ...notificationSignals,
        ...automations().slice(0, 10).map((automation) => ({
          id: automation.id,
          type: 'automation',
          label: automation.name,
          enabled: automation.enabled,
          running: automation.isRunning,
          nextRunAt: automation.nextRunAt,
        })),
      ],
    });
  });

  const resourceSource = createMemo<TeamPulseResourceSource | undefined>(() => {
    const context = promptContext();
    if (!context) return undefined;
    return { context, refreshToken: props.refreshToken() };
  });

  const [pulse] = createResource(resourceSource, async (source) => {
    if (source.refreshToken === 0) {
      const cached = readCachedPulse(source.context);
      if (cached) return cached;
    }

    const result = await cognitionApiServiceClient.structuredCompletion({
      model: AgentModel.fast,
      output_schema: {
        name: 'EntityFirstTeamPulse',
        description: 'An entity-first team dashboard pulse.',
        schema: teamPulseSchema,
      },
      prompt: `You are generating an entity-first team pulse for a team dashboard.

Use ONLY the JSON context. This section is for the entire team over the last 7 days, not a personal inbox for the current user. Do not over-prioritize the currentUserId except when it helps identify team membership. Prefer team-level work, shared channels, shared tasks, automations, and cross-member activity from the provided timeframe over personal follow-ups.

The context includes availableEntities. Select the most useful real entities for the team as a whole and copy id, type, and label from availableEntities exactly. Do not create fake entity ids. Use the semantic entity type from availableEntities.

Return the same shape every time:
- overview: one concise paragraph about what the team appears to have been working on over the last week.
- health: one short sentence on whether the team looks active, quiet, blocked, or waiting on responses.
- entities: exactly 6 important real entities when at least 6 are available, otherwise return every available useful entity. Each reason should explain why this item matters to the team now, not just to one user. Categorize each as working_on, needs_attention, or recent_signal.

Rules:
- Prefer concrete entity-backed output over generic text.
- Include items that represent active team work and items that may need team-level follow-up.
- Use cautious language when inferring.
- Do not invent projects, deadlines, people, ids, types, or labels.
- Avoid generic productivity advice.

JSON context:\n${source.context}`,
    });

    if (result.isErr()) throw new Error('Failed to generate team pulse');
    if (!isTeamPulse(result.value.result)) {
      throw new Error('Invalid team pulse response');
    }

    writeCachedPulse(source.context, result.value.result);
    return result.value.result;
  });

  return (
    <Show
      when={firstTeam()}
      fallback={
        <div class="text-sm text-ink-muted">
          Create a team to see a pulse here.
        </div>
      }
    >
      <Suspense fallback={<TeamPulseSkeleton />}>
        <Switch>
          <Match when={pulse()}>
            {(data) => (
              <div>
                <div class="px-4 sm:px-0">
                  <div class="rounded-xl bg-hover/50 p-3">
                  <div class="flex min-w-0 items-start gap-2">
                    <AnimatedStarIcon
                      class="size-4 shrink-0 translate-y-px text-accent"
                      triggerAnimation
                    />
                    <div class="flex min-w-0 flex-col gap-3">
                      <p class="text-xs text-ink-muted">
                        {data().health}
                      </p>
                      <p class="text-sm leading-6 text-ink">
                        {data().overview}
                      </p>
                    </div>
                  </div>
                  </div>
                </div>

                <AdaptiveScroller scrollAmount={280} class="relative">
                  <AdaptiveScroller.Viewport class="mt-3 scroll-pl-4 px-4 pb-1 sm:px-0 @3xl/dashboard:grid @3xl/dashboard:grid-cols-2 @3xl/dashboard:overflow-visible @3xl/dashboard:pb-0 @6xl/dashboard:grid-cols-4">
                    <For each={data().entities}>
                      {(entity) => <PulseEntityRow entity={entity} />}
                    </For>
                  </AdaptiveScroller.Viewport>
                  <AdaptiveScroller.FadeEdges class="bottom-10 top-3 hidden sm:block @3xl/dashboard:hidden" />
                  <AdaptiveScroller.Controls class="mt-2 @3xl/dashboard:hidden">
                    <AdaptiveScroller.Control
                      direction="left"
                      class="hidden sm:inline-flex @3xl/dashboard:hidden"
                    />
                    <AdaptiveScroller.Control
                      direction="right"
                      class="hidden sm:inline-flex @3xl/dashboard:hidden"
                    />
                  </AdaptiveScroller.Controls>
                </AdaptiveScroller>

              </div>
            )}
          </Match>
          <Match when={true}>
            <TeamPulseSkeleton />
          </Match>
        </Switch>
      </Suspense>
    </Show>
  );
}

export function TeamPulseSection() {
  const [refreshToken, setRefreshToken] = createSignal(0);
  const userTeamsQuery = useUserTeamsQuery();
  const userId = useUserId();
  const { openSettings } = useSettingsState();

  const firstTeam = createMemo(() => userTeamsQuery.data?.[0]);
  const teamQuery = useTeamQuery(() => firstTeam()?.id ?? '');
  const currentMember = createMemo(() =>
    teamQuery.data?.members.find((member) => member.user_id === userId())
  );
  const isOwner = createMemo(() => currentMember()?.role === TeamRole.owner);

  return (
    <section>
      <div class="flex items-start justify-between gap-3 px-4 sm:px-0">
        <div class="flex min-w-0 items-center gap-2">
          <h2 class="truncate text-lg font-semibold tracking-tight text-ink">
            {firstTeam()?.name ?? 'Team'}
          </h2>
          <Show when={firstTeam()}>
            {(team) => (
              <span class="shrink-0 truncate text-xxs text-ink-muted">
                @{team().slug}
              </span>
            )}
          </Show>
        </div>
        <div class="flex shrink-0 items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            class="rounded-lg"
            onClick={() => setRefreshToken((value) => value + 1)}
          >
            <RefreshIcon class="size-3.5" />
            Refresh
          </Button>
          <Show when={firstTeam() && isOwner()}>
            <Button
              variant="base"
              size="sm"
              depth={3}
              class="h-8 rounded-lg bg-surface px-3"
              onClick={() => openSettings('Team')}
            >
              Manage
            </Button>
          </Show>
        </div>
      </div>

      <div class="mt-4">
        <ErrorBoundary
          fallback={(error, reset) => (
            <DashboardSectionError
              error={error instanceof Error ? error : new Error(String(error))}
              reset={reset}
              title="team pulse"
            />
          )}
        >
          <TeamPulseContent refreshToken={refreshToken} />
        </ErrorBoundary>
      </div>
    </section>
  );
}
