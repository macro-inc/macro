import { DashboardSectionError } from '@app/component/dashboard/dashboard-section-error';
import { globalSplitManager } from '@app/signal/splitLayout';
import {
  EntityIcon,
  type EntityIconSelector,
} from '@core/component/EntityIcon';
import { UserIcon } from '@core/component/UserIcon';
import { useSettingsState } from '@core/constant/SettingsState';
import { useUserId } from '@core/context/user';
import { PulsingStar } from '@entity/components/PulsingStar';
import { AnimatedStarIcon } from '@icon/wide-star';
import { Collapsible } from '@kobalte/core/collapsible';
import { Popover } from '@kobalte/core/popover';
import RefreshIcon from '@phosphor/arrow-clockwise.svg';
import UsersIcon from '@phosphor/users.svg';
import { useTeamQuery, useUserTeamsQuery } from '@queries/team';
import { TeamRole } from '@service-auth/generated/schemas/teamRole';
import { cognitionApiServiceClient } from '@service-cognition/client';
import { AgentModel } from '@service-cognition/generated/schemas/agentModel';
import { ToolSetOneOfType } from '@service-cognition/generated/schemas/toolSetOneOfType';
import { Button, Layer, Surface } from '@ui';
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

type TeamPulseReference = {
  id: string;
  type: string;
  label: string;
};

type TeamPulseSummary = {
  memberId: string;
  memberLabel: string;
  summary: string;
  references: TeamPulseReference[];
};

type TeamPulseActionItem = {
  title: string;
  action: string;
  references: TeamPulseReference[];
};

type TeamPulse = {
  overview: string;
  health: string;
  summaries: TeamPulseSummary[];
  actionItems: TeamPulseActionItem[];
};

type TeamPulseResourceSource = {
  context: string;
  refreshToken: number;
};

const TEAM_PULSE_CACHE_PREFIX = 'dashboard:team-pulse:summaries-actions:v1:';
const TEAM_PULSE_CACHE_TTL_MS = 999 * 60 * 1000;

const teamPulseReferenceSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['id', 'type', 'label'],
  properties: {
    id: { type: 'string' },
    type: {
      type: 'string',
      enum: ['channel', 'email', 'task', 'document', 'project', 'chat', 'call'],
    },
    label: { type: 'string' },
  },
};

const teamPulseSummarySchema = {
  type: 'object',
  additionalProperties: false,
  required: ['memberId', 'memberLabel', 'summary', 'references'],
  properties: {
    memberId: { type: 'string' },
    memberLabel: { type: 'string' },
    summary: { type: 'string' },
    references: {
      type: 'array',
      maxItems: 3,
      items: teamPulseReferenceSchema,
    },
  },
};

const teamPulseActionItemSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['title', 'action', 'references'],
  properties: {
    title: { type: 'string' },
    action: { type: 'string' },
    references: {
      type: 'array',
      maxItems: 3,
      items: teamPulseReferenceSchema,
    },
  },
};

const teamPulseSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['overview', 'health', 'summaries', 'actionItems'],
  properties: {
    overview: { type: 'string' },
    health: { type: 'string' },
    summaries: {
      type: 'array',
      minItems: 0,
      maxItems: 10,
      items: teamPulseSummarySchema,
    },
    actionItems: {
      type: 'array',
      minItems: 0,
      maxItems: 10,
      items: teamPulseActionItemSchema,
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
  return `${TEAM_PULSE_CACHE_PREFIX}`;
}

function isTeamPulseReference(value: unknown): value is TeamPulseReference {
  if (!value || typeof value !== 'object') return false;
  const reference = value as Partial<TeamPulseReference>;
  return (
    typeof reference.id === 'string' &&
    typeof reference.type === 'string' &&
    typeof reference.label === 'string'
  );
}

function isTeamPulseSummary(value: unknown): value is TeamPulseSummary {
  if (!value || typeof value !== 'object') return false;
  const item = value as Partial<TeamPulseSummary>;
  return (
    typeof item.memberId === 'string' &&
    typeof item.memberLabel === 'string' &&
    typeof item.summary === 'string' &&
    Array.isArray(item.references) &&
    item.references.every(isTeamPulseReference)
  );
}

function isTeamPulseActionItem(value: unknown): value is TeamPulseActionItem {
  if (!value || typeof value !== 'object') return false;
  const item = value as Partial<TeamPulseActionItem>;
  return (
    typeof item.title === 'string' &&
    typeof item.action === 'string' &&
    Array.isArray(item.references) &&
    item.references.every(isTeamPulseReference)
  );
}

function isTeamPulse(value: unknown): value is TeamPulse {
  if (!value || typeof value !== 'object') return false;
  const pulse = value as Partial<TeamPulse>;
  return (
    typeof pulse.overview === 'string' &&
    typeof pulse.health === 'string' &&
    Array.isArray(pulse.summaries) &&
    pulse.summaries.every(isTeamPulseSummary) &&
    Array.isArray(pulse.actionItems) &&
    pulse.actionItems.every(isTeamPulseActionItem)
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

function openPulseReference(
  reference: TeamPulseReference,
  event: { shiftKey: boolean }
) {
  const type = splitType(reference.type);
  if (!reference.id || !type) return;

  globalSplitManager()?.openWithSplit(
    { type: type as any, id: reference.id },
    {
      activate: true,
      referredFrom: 'dashboard',
      preferNewSplit: event.shiftKey,
    }
  );
}

function TeamPulseReferencePill(props: { reference: TeamPulseReference }) {
  return (
    <button
      class="group/pill relative flex min-w-0 items-center gap-1 rounded-md border border-edge-muted bg-surface px-2 py-1 text-left hover:border-edge hover:bg-hover focus:outline-none focus-visible:border-accent"
      onClick={(event) => {
        event.stopPropagation();
        openPulseReference(props.reference, event);
      }}
    >
      <span class="size-3 min-w-3 shrink-0">
        <EntityIcon targetType={iconType(props.reference.type)} size="fill" />
      </span>
      <span class="text-xs font-medium truncate">{props.reference.label}</span>
    </button>
  );
}

function TeamPulseReferenceMenuItem(props: { reference: TeamPulseReference }) {
  return (
    <button
      class="group flex h-8 w-full cursor-default items-center gap-1 rounded-lg px-2 text-left text-xs font-medium outline-none hover:bg-ink/5 focus:bg-ink/5"
      onClick={(event) => {
        event.stopPropagation();
        openPulseReference(props.reference, event);
      }}
    >
      <span class="size-3 min-w-3 shrink-0">
        <EntityIcon targetType={iconType(props.reference.type)} size="fill" />
      </span>
      <span class="truncate">{props.reference.label}</span>
    </button>
  );
}

function TeamPulseReferencesPopover(props: {
  references: TeamPulseReference[];
}) {
  const primaryReference = () => props.references[0];

  return (
    <Show
      when={props.references.length > 1}
      fallback={
        <Show when={primaryReference()}>
          {(reference) => <TeamPulseReferencePill reference={reference()} />}
        </Show>
      }
    >
      <Popover placement="bottom-start" gutter={6}>
        <Popover.Trigger
          class="flex w-fit items-center gap-1 rounded-md border border-edge-muted bg-surface/60 px-2 py-1 text-xs text-ink-muted transition hover:border-edge hover:bg-surface focus:outline-none focus-visible:border-accent"
          onClick={(event) => event.stopPropagation()}
        >
          <Show when={primaryReference()}>
            {(reference) => (
              <span class="size-3 min-w-3 shrink-0">
                <EntityIcon
                  targetType={iconType(reference().type)}
                  size="fill"
                />
              </span>
            )}
          </Show>
          <span>{props.references.length} references</span>
        </Popover.Trigger>

        <Popover.Portal>
          <Popover.Content class="z-action-menu">
            <Surface depth={2} class="rounded-xl">
              <div class="flex min-w-48 max-w-xs flex-col gap-px bg-edge-muted">
                <div class="flex flex-col gap-0.5 bg-surface p-1.5">
                  <For each={props.references}>
                    {(reference) => (
                      <TeamPulseReferenceMenuItem reference={reference} />
                    )}
                  </For>
                </div>
              </div>
            </Surface>
          </Popover.Content>
        </Popover.Portal>
      </Popover>
    </Show>
  );
}

function PulseClickableRow(props: {
  references: TeamPulseReference[];
  icon: 'entity' | 'user';
  memberId?: string;
  title: string;
  description: string;
}) {
  const primaryReference = () => props.references[0];

  return (
    <div class="flex flex-col gap-2 py-2">
      <div class="flex min-w-0 items-start gap-2">
        <Show
          when={props.icon === 'user' && props.memberId}
          fallback={
            <Show when={primaryReference()}>
              {(reference) => (
                <EntityIcon
                  targetType={iconType(reference().type)}
                  size="sm"
                  class="mt-0.5 shrink-0 touch:size-5"
                />
              )}
            </Show>
          }
        >
          {(id) => (
            <UserIcon
              id={id()}
              size="md"
              class="touch:size-9"
              suppressClick
              showTooltip={false}
            />
          )}
        </Show>
        <div class="min-w-0 flex-1">
          <p class="truncate text-sm font-semibold text-ink">{props.title}</p>
          <p class="text-xs leading-5 text-ink-muted">{props.description}</p>
        </div>
      </div>

      <Show when={props.references.length > 0}>
        <div class="pl-10">
          <TeamPulseReferencesPopover references={props.references} />
        </div>
      </Show>
    </div>
  );
}

function TeamPulseSummaryRow(props: { item: TeamPulseSummary }) {
  return (
    <PulseClickableRow
      references={props.item.references}
      icon="user"
      memberId={props.item.memberId}
      title={props.item.memberLabel || props.item.memberId}
      description={props.item.summary}
    />
  );
}

function TeamPulseActionItemRow(props: { item: TeamPulseActionItem }) {
  return (
    <PulseClickableRow
      references={props.item.references}
      icon="entity"
      title={props.item.title}
      description={props.item.action}
    />
  );
}

function TeamPulseSummaryCard(props: { data: TeamPulse }) {
  const [open, setOpen] = createSignal(false);
  const hasDetails = () =>
    props.data.summaries.length > 0 || props.data.actionItems.length > 0;

  return (
    <div class="bg-active p-4 rounded-xl flex min-w-0 items-start gap-3">
      <AnimatedStarIcon
        class="size-4 shrink-0 translate-y-px"
        triggerAnimation
      />
      <div class="flex min-w-0 flex-1 flex-col gap-2">
        <p class="text-sm text-ink">{props.data.health}</p>
        <p class="text-xs leading-6 text-ink-muted">{props.data.overview}</p>

        <Show
          when={hasDetails()}
          fallback={
            <p class="pt-2 text-sm text-ink-muted">
              No clear activity or follow-ups surfaced yet.
            </p>
          }
        >
          <Collapsible open={open()} onOpenChange={setOpen}>
            <Collapsible.Content>
              <Layer depth={3}>
                <div class="mt-2 flex flex-col gap-2">
                  <For each={props.data.summaries}>
                    {(item) => <TeamPulseSummaryRow item={item} />}
                  </For>
                  <For each={props.data.actionItems}>
                    {(item) => <TeamPulseActionItemRow item={item} />}
                  </For>
                </div>
              </Layer>
            </Collapsible.Content>

            <Collapsible.Trigger class="mt-1 w-fit rounded text-xs font-medium text-accent transition hover:text-accent focus:outline-none focus-visible:ring focus-visible:ring-edge">
              {open() ? 'Show less' : 'Show more'}
            </Collapsible.Trigger>
          </Collapsible>
        </Show>
      </div>
    </div>
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
      <div class="mt-3 space-y-1 px-4 sm:px-0">
        <For each={[0, 1, 2, 3]}>
          {() => (
            <div class="flex items-start gap-3 rounded-lg px-2 py-2.5">
              <div class="skeleton-shimmer size-8 shrink-0 rounded-full bg-ink/10" />
              <div class="min-w-0 flex-1">
                <div class="skeleton-shimmer mb-2 h-3 w-28 rounded-full bg-ink/10" />
                <div class="skeleton-shimmer mb-2 h-3 w-4/5 rounded-full bg-ink/5" />
                <div class="skeleton-shimmer h-2.5 w-2/3 rounded-full bg-ink/5" />
              </div>
            </div>
          )}
        </For>
      </div>
    </div>
  );
}

function TeamPulseContent(props: { refreshToken: Accessor<number> }) {
  const userTeamsQuery = useUserTeamsQuery();
  const userId = useUserId();

  const firstTeam = createMemo(() => userTeamsQuery.data?.[0]);
  const teamQuery = useTeamQuery(() => firstTeam()?.id ?? '');

  const promptContext = createMemo(() => {
    const team = firstTeam();
    if (!team || !teamQuery.data) return undefined;

    const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

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
      toolset: { type: ToolSetOneOfType.all },
      output_schema: {
        name: 'TeamPulseWithCurrentUserActions',
        description:
          'Team member work summaries plus action items the current user needs to follow up on.',
        schema: teamPulseSchema,
      },
      prompt: `You are generating a team pulse for the current user's dashboard.

Use the JSON context for currentUserId, team membership, and timeframe. Then use your available tools to gather the information yourself. The goal is to return both: (1) concise summaries of what active team members are working on, and (2) concrete things the current user needs to follow up on or do now.

You must actively search across tasks, calls, channels, emails, chats, documents, and projects. Use multiple relevant tools when needed instead of relying on one source. For summaries, look for signals authored by, assigned to, mentioning, or clearly involving team members. For action items, look for tasks assigned to the current user, direct mentions, unanswered questions, requests for review/approval, promised follow-ups, blocked work needing the current user's input, emails needing replies, call action items, and channel/chat discussions that clearly assign work to the current user.

Return the same shape every time:
- overview: one concise paragraph summarizing team activity and the current user's follow-up workload.
- health: one short sentence on whether the team/current user looks clear, busy, blocked, waiting on others, or has urgent follow-ups.
- summaries: team member work summaries. Include members with recent activity first. Omit inactive members unless discovered chat, email, channel, or call evidence explicitly indicates why they are inactive, such as vacation, out of office, sick leave, parental leave, travel, focus time, or another availability reason. Return an empty summaries array if there is not enough evidence for any member.
- actionItems: actionable follow-ups for currentUserId, ordered by urgency and specificity. Return an empty actionItems array if there is not enough evidence for any action item.

For each summaries item:
- memberId must exactly match a member id from members.
- memberLabel should be a short readable label for the member; use the id if no better label is available.
- summary should be a short present-tense summary of what they appear to be working on, e.g. "Following up on onboarding tasks". For an explicitly inactive member, summarize the reason, e.g. "Out on vacation this week".
- references should contain up to 3 real entities found with tools that support the summary. Return each reference with id, type, and label. The label must be the entity's actual name/title/subject from the tool result, not a custom summary or generated label. Allowed reference types are channel, email, task, document, project, chat, and call.

For each actionItems item:
- title should be a short action-oriented title, e.g. "Reply to onboarding thread" or "Review launch task".
- action should be a concise description of what the current user should do next and why.
- references should contain up to 3 real entities found with tools that support the action item. Return each reference with id, type, and label. The label must be the entity's actual name/title/subject from the tool result, not a custom summary or generated label. Allowed reference types are channel, email, task, document, project, chat, and call.

Inference rules:
- Prefer concrete, entity-backed summaries and action items over generic text.
- Use cautious language when inferring.
- Do not include FYI-only updates as action items unless the current user clearly needs to act.
- Do not include a member just to say they are quiet or have no data.
- Do not invent projects, deadlines, people, ids, types, labels, activity, action items, availability reasons, or references.
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
              <div class="px-4 sm:px-0">
                <TeamPulseSummaryCard data={data()} />
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
    <section class="mx-auto w-full max-w-3xl">
      <div class="flex items-start justify-between gap-3 px-4 sm:px-0">
        <header>
          <div class="flex min-w-0 items-center gap-2">
            <h1 class="truncate text-lg font-semibold tracking-tight text-ink">
              {firstTeam()?.name ?? 'Team'}
            </h1>
          </div>
          <p class="text-xs text-ink-extra-muted font-normal">Team pulse</p>
        </header>
        <div class="flex shrink-0 items-center gap-2">
          <Button
            variant="ghost"
            class="rounded-lg"
            onClick={() => setRefreshToken((value) => value + 1)}
          >
            <RefreshIcon class="size-3.5" />
          </Button>
          <Show when={firstTeam() && isOwner()}>
            <Button
              variant="ghost"
              class="rounded-lg"
              onClick={() => openSettings('Team')}
            >
              <UsersIcon class="size-3.5" />
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
