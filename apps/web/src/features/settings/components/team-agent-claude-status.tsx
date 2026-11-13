import { t } from '@app/lib/i18n';
import { Show } from 'solid-js';
import { match } from 'ts-pattern';
import type { AgentClaudeState } from '../core/team-agent-claude';

/**
 * Which Claude an agent teammate's computer runs on, under its name in
 * Members, with the one change that applies: sign in to the team's Claude
 * plan (again, once expired), or go back to Macro credits.
 */
export function TeamAgentClaudeStatus(props: {
  state: AgentClaudeState;
  /** Sign-in needs the computer running: its link comes from there. */
  canSignIn: boolean;
  pending: boolean;
  onSignIn: () => void;
  onUseCredits: () => void;
}) {
  const label = () =>
    match(props.state)
      .with('loading', () => undefined)
      .with('credits', () => t('teamAgents.claudeCredits'))
      .with('signed_in', () => t('teamAgents.claudeSignedInState'))
      .with('expired', () => t('teamAgents.claudeExpired'))
      .exhaustive();

  const action = () =>
    match(props.state)
      .with('loading', () => undefined)
      .with('credits', 'expired', () =>
        props.canSignIn
          ? { label: t('teamAgents.signInToClaude'), onClick: props.onSignIn }
          : undefined
      )
      .with('signed_in', () => ({
        label: t('teamAgents.useCredits'),
        onClick: props.onUseCredits,
      }))
      .exhaustive();

  return (
    <Show when={label()}>
      {(text) => (
        <div
          data-agent-claude={props.state}
          class="flex flex-wrap items-center gap-x-1.5 text-xs text-ink-muted max-sm:flex-col max-sm:items-start"
        >
          <span class={props.state === 'expired' ? 'text-failure' : undefined}>
            {text()}
          </span>
          <Show when={action()}>
            {(current) => (
              <span class="flex items-center gap-x-1.5 whitespace-nowrap">
                <span aria-hidden="true" class="max-sm:hidden">
                  ·
                </span>
                <button
                  type="button"
                  class="font-medium text-ink underline-offset-2 not-touch:hover:underline disabled:opacity-50 touch:py-1.5"
                  disabled={props.pending}
                  onClick={() => current().onClick()}
                >
                  {current().label}
                </button>
              </span>
            )}
          </Show>
        </div>
      )}
    </Show>
  );
}
