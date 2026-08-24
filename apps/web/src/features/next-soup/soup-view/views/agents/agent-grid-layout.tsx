import { harnessTitle } from '@app/features/block-agent/harness-title';
import {
  type SessionStatusLike,
  SessionStatusPill,
} from '@app/features/block-agent/ui/SessionStatusPill';
import { openExternalUrl } from '@core/util/url';
import type { AgentSessionEntity } from '@entity';
import {
  Entity,
  isAgentSessionEntity,
  MultiSelectCheckbox,
  UnreadIndicator,
} from '@entity';
import type { LayoutProps } from '@entity/composed/list-entity/shared';
import GitBranch from '@phosphor/git-branch.svg';
import { cn } from '@ui/utils/classname';
import { Show } from 'solid-js';
import {
  AGENT_GRID_TEMPLATE_AREAS_WIDE,
  AGENT_GRID_TEMPLATE_AREAS_WIDE_NO_INDICATOR,
  AGENT_GRID_TEMPLATE_COLUMNS_WIDE,
  AGENT_GRID_TEMPLATE_COLUMNS_WIDE_NO_INDICATOR,
} from './agent-grid-template';

/** 'https://github.com/acme/widgets.git' → 'acme/widgets'. */
export function repoName(repoUrl: string | undefined): string | undefined {
  if (!repoUrl) return undefined;
  const path = repoUrl
    .replace(/\.git$/, '')
    .split('/')
    .filter(Boolean);
  if (path.length < 2) return undefined;
  return `${path[path.length - 2]}/${path[path.length - 1]}`;
}

/** The pill component's wire-shaped status, from the flat entity fields. */
function sessionStatus(session: AgentSessionEntity): SessionStatusLike {
  if (session.statusKind === 'event') {
    return { kind: 'event', event: session.statusEventName ?? '' };
  }
  return { kind: session.statusKind };
}

/**
 * Wide-layout grid row for an agent session: title + attention badges, then
 * fixed status / model / harness columns so values line up down the list.
 * Sessions carry no properties, so unlike the task row there is no
 * PropertiesProvider and nothing is editable inline.
 */
export function AgentGridLayout(props: LayoutProps) {
  const session = () =>
    isAgentSessionEntity(props.entity) ? props.entity : undefined;

  return (
    <Entity.Layout
      class={cn(
        'w-full min-h-[inherit] items-center text-sm px-2',
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
          <Entity.Title entity={props.entity} />
        </span>
        <Show when={(session()?.pendingPermissionCount ?? 0) > 0}>
          <span class="shrink-0 rounded-full bg-alert/15 text-alert px-2 py-0.5 text-xs font-medium">
            Needs approval ({session()?.pendingPermissionCount})
          </span>
        </Show>
        <Show when={session()?.prUrl}>
          {(prUrl) => (
            <button
              type="button"
              class="shrink-0 rounded-full bg-accent/15 text-accent px-2 py-0.5 text-xs font-medium hover:bg-accent/25 cursor-pointer"
              onClick={(event) => {
                event.stopPropagation();
                openExternalUrl(prUrl());
              }}
            >
              PR ready
            </button>
          )}
        </Show>
        <Show when={repoName(session()?.repoUrl)}>
          {(name) => (
            <span class="ph-no-capture text-ink-muted text-xs shrink-0 truncate border border-edge-muted px-2 rounded-sm py-0.5 inline-flex items-center gap-1">
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
          {(current) => <SessionStatusPill status={sessionStatus(current())} />}
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
