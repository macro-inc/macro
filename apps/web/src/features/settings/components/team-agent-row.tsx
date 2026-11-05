import { t } from '@app/lib/i18n';
import { AgentTag } from '@core/component/AgentTag';
import DotsIcon from '@icon/system/regular/dots-three.svg';
import RobotIcon from '@icon/system/regular/robot.svg';
import type { TeamAgent } from '@service-auth/generated/schemas';
import { Dropdown, Tooltip } from '@ui';
import { formatDistanceToNowStrict } from 'date-fns';
import { type JSX, Show } from 'solid-js';
import { MemberRowLayout } from './member-row-layout';

export { AgentStatusPill } from './team-agent-status';

import { canRetryTeamAgent } from '../teamMemberPermissions';
import { AgentStatusPill } from './team-agent-status';

export function TeamAgentRow(props: {
  agent: TeamAgent;
  avatar: JSX.Element;
  retrying: boolean;
  retryError?: boolean;
  onRetry(): void;
  onRemove(): void;
}) {
  const lastActive = () => {
    if (!props.agent.lastTurnAt) return 'No activity yet';
    const at = new Date(props.agent.lastTurnAt);
    if (Number.isNaN(at.getTime())) return 'Activity unavailable';
    return `Last active ${formatDistanceToNowStrict(at, { addSuffix: true })}`;
  };
  return (
    <MemberRowLayout
      kind="agent"
      avatar={
        <>
          {props.avatar}
          <span
            class="absolute -bottom-0.5 -right-0.5 rounded-full bg-panel ring-2 ring-panel p-0.5"
            aria-label="Agent avatar"
          >
            <RobotIcon class="size-3 text-ink-muted" />
          </span>
        </>
      }
      name={
        <>
          <Tooltip label={props.agent.name} class="min-w-0">
            <span class="truncate" data-member-name>
              {props.agent.name}
            </span>
          </Tooltip>
          <AgentTag />
        </>
      }
      detail={<span>Member</span>}
      status={<AgentStatusPill agent={props.agent} activity={lastActive()} />}
      actions={
        <TeamAgentMenu
          agent={props.agent}
          onRemove={props.onRemove}
          onRetry={props.onRetry}
          retrying={props.retrying}
          retryError={props.retryError}
        />
      }
    />
  );
}

export function TeamAgentMenu(props: {
  agent: TeamAgent;
  retrying?: boolean;
  retryError?: boolean;
  onRetry?(): void;
  onRemove(): void;
}) {
  return (
    <Dropdown>
      <Dropdown.Trigger
        variant="ghost"
        size="icon-sm"
        aria-label={t('common.more')}
      >
        <DotsIcon class="size-4" />
      </Dropdown.Trigger>
      <Dropdown.Content>
        <Show when={props.agent.statusReason}>
          <div
            class="max-w-64 px-3 py-2 text-xs text-ink-muted break-words"
            role="note"
          >
            {props.agent.statusReason}
          </div>
        </Show>
        <Show when={props.retryError}>
          <div class="max-w-64 px-3 py-2 text-xs text-failure" role="alert">
            Retry failed. Check the status and try again.
          </div>
        </Show>
        <Show when={props.onRetry && canRetryTeamAgent(props.agent)}>
          <Dropdown.Item
            disabled={props.retrying}
            onSelect={() => {
              if (!props.retrying && canRetryTeamAgent(props.agent))
                props.onRetry?.();
            }}
          >
            {t('common.retry')}
          </Dropdown.Item>
        </Show>
        <Dropdown.Item
          disabled={props.agent.payment === 'pending'}
          onSelect={() => props.agent.payment !== 'pending' && props.onRemove()}
        >
          {t('common.removeTeamAgent')}
        </Dropdown.Item>
      </Dropdown.Content>
    </Dropdown>
  );
}
