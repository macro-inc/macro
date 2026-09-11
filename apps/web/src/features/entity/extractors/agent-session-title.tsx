import { AgentSessionMentionLabel } from '@core/component/LexicalMarkdown/component/decorator/AgentSessionMentionLabel';
import { createAgentSessionMentionStatus } from '@queries/agent-session/mention-status';
import { normalizeAgentSessionStatus } from '@queries/agent-session/mention-types';
import { useAgentSessionMentionPreview } from '@queries/agent-session/mentions';
import { subscribeAgentSessionLog } from '@queries/agent-session/session-fold';
import type { AgentSessionEntity } from '../types/entity';

/** Query reads are guarded so a pending row cannot suspend the list. */
export function AgentSessionTitle(props: { entity: AgentSessionEntity }) {
  const query = useAgentSessionMentionPreview(
    () => props.entity.id,
    () => true
  );
  const preview = () => (query.isSuccess ? query.data.preview : undefined);
  const session = () => {
    const value = preview();
    return value?.access === 'access' ? value.data : undefined;
  };
  const denied = () => preview() && preview()?.access !== 'access';
  const status = createAgentSessionMentionStatus(
    () => (denied() || query.isError ? undefined : props.entity.id),
    () =>
      denied() || query.isError
        ? undefined
        : {
            status:
              session()?.status ??
              normalizeAgentSessionStatus(props.entity.status),
            updatedAt: query.isSuccess ? query.data.requestedAt : 0,
          },
    subscribeAgentSessionLog
  );
  const label = () => {
    if (preview()?.access === 'no_access') return 'Private agent session';
    if (preview()?.access === 'does_not_exist') return 'Deleted agent session';
    if (query.isError) return 'Agent session unavailable';
    return session()?.name || props.entity.name || 'Agent session';
  };
  return (
    <span class="min-w-0 flex items-center gap-1">
      <AgentSessionMentionLabel
        label={label()}
        bot={
          denied() || query.isError
            ? undefined
            : (session()?.bot ?? props.entity.bot)
        }
        status={status()}
      />
    </span>
  );
}
