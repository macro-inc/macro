import { t } from '@app/lib/i18n';
import { AgentTag } from '@core/component/AgentTag';
import { UserIcon } from '@core/component/UserIcon';
import type { TeamAgent } from '@service-auth/team-agents';
import { type JSX, Show } from 'solid-js';
import { TeamAgentStatusLabel } from './team-agent-status';

/**
 * An agent teammate in Team › Members, laid out like a person's row: its
 * picture and name, what it does, its status where a person's role and plan
 * are, and its ⋯ at the end.
 */
export function TeamAgentRow(props: {
  agent: TeamAgent;
  /** Its ⋯; left out for viewers who can't change anything. */
  menu?: JSX.Element;
  /** Which of its owner's machines it runs on, if it runs on one. */
  runsOn?: JSX.Element;
  /** Its status in words, in place of the status's own (e.g. "Moving to laptop"). */
  statusLabel?: string;
  /** Why its own machine couldn't run it, under its status. */
  problem?: string;
  /** A problem the owner caused on purpose (a parked agent) reads muted, not as a failure. */
  problemTone?: 'failure' | 'muted';
  /** Which Claude its computer runs on, for viewers who manage it. */
  claude?: JSX.Element;
  /** The step its computer's setup is on, while it is being set up. */
  setupStep?: string;
  /** Sets its failed computer up again; for viewers who manage it. */
  onRetry?: () => void;
  retrying?: boolean;
}) {
  return (
    <div
      data-member-kind="agent"
      class="flex items-center gap-3 px-4 py-4 touch:min-h-[44px]"
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
          {/* Its summary line, where a person's role and plan are: its
              status, then the machine it runs on. */}
          <div class="flex min-w-0 items-center gap-1.5">
            <TeamAgentStatusLabel
              status={props.agent.status}
              label={props.statusLabel}
            />
            {props.runsOn}
          </div>
          <Show when={props.problem}>
            {(problem) => (
              <div
                data-agent-problem
                class="text-xs"
                classList={{
                  'text-failure': props.problemTone !== 'muted',
                  'text-ink-muted': props.problemTone === 'muted',
                }}
              >
                {problem()}
              </div>
            )}
          </Show>
          <Show when={props.setupStep}>
            {(step) => (
              <div
                data-agent-setup-step
                class="text-xs text-ink-muted truncate"
              >
                {step()}
              </div>
            )}
          </Show>
          {/* Under the description, like the Claude line's action. */}
          <Show when={props.onRetry}>
            {(retry) => (
              <button
                type="button"
                data-agent-setup-retry
                class="text-xs font-medium text-ink underline-offset-2 not-touch:hover:underline disabled:opacity-50 touch:py-1.5"
                disabled={props.retrying}
                onClick={() => retry()()}
              >
                {t('teamAgents.retrySetup')}
              </button>
            )}
          </Show>
          {props.claude}
        </div>
      </div>
      {props.menu}
    </div>
  );
}
