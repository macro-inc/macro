import {
  type SessionStatusLike,
  type SessionStatusPresentation,
  sessionStatusPresentation,
} from '@app/features/block-agent/ui/SessionStatusPill';
import { harnessTitle, repoNameFromUrl } from '@core/util/agent-session';
import {
  type AgentSessionEntity,
  Entity,
  isAgentSessionEntity,
  MultiSelectCheckbox,
  UnreadIndicator,
} from '@entity';
import type { LayoutProps } from '@entity/composed/list-entity/shared';
import GitBranch from '@phosphor/git-branch.svg';
import {
  type AgentSessionLiveState,
  agentSessionLiveState,
} from '@queries/agent-session/live-list-state';
import { cn } from '@ui/utils/classname';
import { Show } from 'solid-js';
import {
  AGENT_GRID_TEMPLATE_AREAS_WIDE,
  AGENT_GRID_TEMPLATE_AREAS_WIDE_NO_INDICATOR,
  AGENT_GRID_TEMPLATE_COLUMNS_WIDE,
  AGENT_GRID_TEMPLATE_COLUMNS_WIDE_NO_INDICATOR,
} from './agent-grid-template';

const sessionStatus = (entity: AgentSessionEntity): SessionStatusLike => {
  if (entity.statusKind === 'event') {
    return { kind: 'event', event: entity.statusEventName ?? '' };
  }
  return { kind: entity.statusKind };
};

/**
 * The session's status as a quiet dot + label, mirroring the block's pill.
 * Followed live where the view watches the session's stream; a working
 * session says so rather than sitting on the runtime's last system event.
 */
const StatusCell = (props: {
  entity: AgentSessionEntity;
  live: AgentSessionLiveState | undefined;
}) => {
  const current = (): SessionStatusPresentation => {
    const live = props.live;
    if (!live) return sessionStatusPresentation(sessionStatus(props.entity));
    if (live.working && live.statusEvent !== 'disconnected') {
      return { label: 'Working', tone: 'positive' };
    }
    return sessionStatusPresentation(
      live.statusEvent
        ? { kind: 'event', event: live.statusEvent }
        : { kind: 'no_messages' }
    );
  };
  return (
    <span class="inline-flex min-w-0 items-center gap-1.5 text-xs text-ink-muted">
      <span
        aria-hidden="true"
        class="size-1.5 shrink-0 rounded-full"
        classList={{
          'bg-success': current().tone === 'positive',
          'bg-ink-placeholder': current().tone === 'neutral',
          'bg-failure': current().tone === 'negative',
        }}
      />
      <span class="truncate">{current().label}</span>
    </span>
  );
};

/**
 * Agent-session list row: title with attention badges, then fixed-width
 * status / model / harness columns so the values line up across rows.
 * Sessions carry no properties, so unlike the task grid there is no
 * PropertiesProvider and nothing is editable inline.
 */
export function AgentGridLayout(props: LayoutProps) {
  const session = () =>
    isAgentSessionEntity(props.entity) ? props.entity : undefined;
  const repoName = () => repoNameFromUrl(session()?.repoUrl);
  // Live fold state where the agents view watches this session's stream;
  // undefined elsewhere (and until the fold's snapshot lands), in which case
  // every cell falls back to the entity's snapshot columns.
  const live = () => {
    const id = session()?.id;
    return id ? agentSessionLiveState(id) : undefined;
  };
  const pendingPermissionCount = () =>
    live()?.pendingPermissionCount ?? session()?.pendingPermissionCount ?? 0;

  return (
    <Entity.Layout
      class={cn(
        'agent-grid-row w-full min-h-[inherit] items-center text-sm px-2',
        'gap-2 grid grid-rows-[1fr]'
      )}
      style={{
        'grid-template-columns': props.hideCheckbox
          ? AGENT_GRID_TEMPLATE_COLUMNS_WIDE_NO_INDICATOR
          : AGENT_GRID_TEMPLATE_COLUMNS_WIDE,
        'grid-template-areas': props.hideCheckbox
          ? AGENT_GRID_TEMPLATE_AREAS_WIDE_NO_INDICATOR
          : AGENT_GRID_TEMPLATE_AREAS_WIDE,
      }}
    >
      <Show when={!props.hideCheckbox}>
        <Entity.Slot placement="indicator" class="relative size-full group">
          <div class="absolute inset-0 grid place-items-center group-hover:opacity-0">
            <UnreadIndicator active={props.unread} />
          </div>
          <div
            class={cn(
              'absolute inset-0 grid place-items-center opacity-0 group-hover:opacity-100',
              {
                'opacity-100': props.checked,
              }
            )}
          >
            <MultiSelectCheckbox
              checked={props.checked}
              onChecked={props.onChecked}
            />
          </div>
        </Entity.Slot>
      </Show>

      <Entity.Slot
        placement="content"
        class="ph-no-capture font-medium truncate items-center gap-2 flex min-w-0"
      >
        <div class="size-4 shrink-0">
          <Entity.Icon entity={props.entity} streamState={props.streamState} />
        </div>
        <span class="truncate min-w-0">
          <Show
            when={live()?.title}
            fallback={<Entity.Title entity={props.entity} />}
          >
            {(title) => title()}
          </Show>
        </span>
        <Show when={pendingPermissionCount() > 0}>
          <span class="shrink-0 text-xs font-medium text-alert border border-alert/20 bg-alert/10 px-2 rounded-sm py-0.5">
            Needs approval ({pendingPermissionCount()})
          </span>
        </Show>
        <Show when={session()?.prUrl}>
          {(prUrl) => (
            <a
              href={prUrl()}
              target="_blank"
              rel="noreferrer"
              onClick={(e) => e.stopPropagation()}
              class="shrink-0 text-xs font-medium text-accent border border-accent/20 bg-accent/10 px-2 rounded-sm py-0.5 hover:bg-accent/20"
            >
              PR ready
            </a>
          )}
        </Show>
        <Show when={repoName()}>
          {(name) => (
            <span class="ph-no-capture text-ink-muted text-xs shrink-0 truncate inline-flex items-center gap-1">
              <GitBranch class="size-3 shrink-0" />
              {name()}
            </span>
          )}
        </Show>
      </Entity.Slot>

      <Entity.Slot
        placement="status"
        class="flex items-center min-w-0 text-xs ph-no-capture"
      >
        <Show when={session()}>
          {(entity) => <StatusCell entity={entity()} live={live()} />}
        </Show>
      </Entity.Slot>

      <Entity.Slot
        placement="model"
        class="flex items-center min-w-0 text-xs text-ink-muted ph-no-capture"
      >
        <span class="truncate">{session()?.model}</span>
      </Entity.Slot>

      <Entity.Slot
        placement="harness"
        class="flex items-center min-w-0 text-xs text-ink-muted ph-no-capture"
      >
        <span class="truncate">{harnessTitle(session()?.harness)}</span>
      </Entity.Slot>

      <Entity.Slot
        placement="timestamp"
        class="text-xs text-right text-ink-extra-muted font-light"
      >
        <Entity.Timestamp entity={props.entity} />
      </Entity.Slot>
    </Entity.Layout>
  );
}
