import {
  ShowPermissionsCard,
  useAgentPermissionsFlag,
} from '@app/features/agent-permissions';
import { t } from '@app/lib/i18n';
import { Match, Switch } from 'solid-js';
import type {
  ToolCallCommon,
  ToolCallContext,
  ToolUsePart,
} from '../component/parts/shared';
import { useOptionalAgentSession } from '../context/AgentSessionContext';
import { parseShowPermissions } from '../state/permission-approval';
import { isToolActive, ToolCard } from '../ui';

/**
 * The agent's ShowPermissions call: while it runs, a quiet row; once
 * answered, the permissions it asked the person to look at, with live
 * controls. With `enable-agent-permissions` off for the viewer it stays a
 * plain row: the controls would read an API that answers 404.
 */
export function ShowPermissionsPart(props: {
  part: ToolUsePart;
  common: ToolCallCommon;
  context: ToolCallContext;
}) {
  const session = useOptionalAgentSession();
  const permissionsFlag = useAgentPermissionsFlag();
  const call = () =>
    permissionsFlag() ? parseShowPermissions(props.part) : undefined;
  const agentName = () =>
    session?.bot()?.name ?? t('agentPermissionsChat.theAgent');

  return (
    <Switch>
      <Match when={isToolActive(props.common.status)}>
        <ToolCard
          title={t('agentPermissionsChat.showingPermissions')}
          status="running"
        />
      </Match>
      <Match when={props.common.status === 'failed' || !call()}>
        <ToolCard
          title={t('agentPermissionsChat.showPermissions')}
          status={props.common.status === 'failed' ? 'failed' : 'completed'}
          muted={props.common.muted}
          trailing={props.common.trailing}
        />
      </Match>
      <Match when={call()}>
        {(current) => (
          <ShowPermissionsCard
            sessionId={props.context.sessionId}
            agentName={agentName()}
            selection={current().selection}
            reason={current().reason}
          />
        )}
      </Match>
    </Switch>
  );
}
