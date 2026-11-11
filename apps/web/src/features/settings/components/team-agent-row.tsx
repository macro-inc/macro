import { t } from '@app/lib/i18n';
import { AgentTag } from '@core/component/AgentTag';
import { UserIcon } from '@core/component/UserIcon';
import TrashIcon from '@icon/system/regular/trash.svg';
import type { TeamAgent } from '@service-auth/team-agents';
import { Button, Tooltip } from '@ui';
import { Show } from 'solid-js';
import { TeamAgentStatusLabel } from './team-agent-status';

/**
 * An agent teammate in Team › Members, laid out like a person's row: its
 * picture and name, what it does, and its status where a person's role is.
 */
export function TeamAgentRow(props: {
  agent: TeamAgent;
  /** Team admins and owners may remove agents. */
  canRemove: boolean;
  onRemove: () => void;
}) {
  return (
    <div
      data-member-kind="agent"
      class="flex items-center justify-between gap-2 px-4 py-4 touch:min-h-[44px]"
    >
      <div class="flex items-center gap-3 min-w-0 flex-1">
        <div class="shrink-0">
          <UserIcon id={props.agent.userId} isDeleted={false} size="lg" />
        </div>
        <div class="min-w-0 flex-1">
          <div class="flex items-center gap-1.5 min-w-0">
            <div class="text-sm font-medium text-ink truncate">
              {props.agent.name}
            </div>
            <AgentTag />
          </div>
          <div class="text-xs text-ink-muted truncate">
            {props.agent.jobDescription}
          </div>
        </div>
      </div>
      <div class="flex items-center gap-2 shrink-0">
        <TeamAgentStatusLabel status={props.agent.status} />
        <Show when={props.canRemove}>
          <Tooltip label={t('teamAgents.remove')}>
            <Button
              variant="ghost"
              size="sm"
              aria-label={t('teamAgents.remove')}
              onClick={() => props.onRemove()}
            >
              <TrashIcon class="size-4" />
            </Button>
          </Tooltip>
        </Show>
      </div>
    </div>
  );
}
