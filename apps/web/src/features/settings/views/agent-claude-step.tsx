import { t } from '@app/lib/i18n';
import { toast } from '@core/component/Toast/Toast';
import type { ClaudeSignInEntry } from '@queries/computers/claude';
import type { TeamAgent } from '@service-auth/team-agents';
import { ClaudeSignInDialog } from '../computers/views/claude-sign-in-dialog';

/**
 * Connect an agent teammate to the team's Claude plan. Opened from the
 * agent's row in Members or from its ready notification, once its computer
 * is connected; always closable, and the agent runs on Macro credits until
 * then.
 */
export function AgentClaudeDialog(props: {
  agent: TeamAgent;
  /** The runtime on the agent's computer, connected. */
  harnessId: string;
  entry: ClaudeSignInEntry;
  onClose: () => void;
}) {
  const name = () => props.agent.name;
  return (
    <ClaudeSignInDialog
      harnessId={props.harnessId}
      entry={props.entry}
      title={t('teamAgents.connectClaudeTitle', { name: name() })}
      description={t('teamAgents.connectClaudeBody', { name: name() })}
      footnote={t('teamAgents.connectClaudeFootnote', { name: name() })}
      switchToCredits={{
        title: t('teamAgents.useCreditsTitle', { name: name() }),
        body: t('teamAgents.useCreditsBody', { name: name() }),
      }}
      onSignedIn={() =>
        toast.success(t('teamAgents.claudeSignedIn', { name: name() }))
      }
      onClose={props.onClose}
    />
  );
}
