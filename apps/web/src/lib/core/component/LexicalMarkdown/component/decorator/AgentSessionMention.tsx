import { useSplitLayout } from '@components/app/split-layout/layout';
import { openInNewSplitForMention } from '@core/util/openInNewSplit';
import { useSplitNavigationHandler } from '@core/util/useSplitNavigationHandler';
import type { AgentSessionMentionDecoratorProps } from '@macro-inc/lexical-core';
import { createAgentSessionMentionStatus } from '@queries/agent-session/mention-status';
import { useAgentSessionMentionPreview } from '@queries/agent-session/mentions';
import { subscribeAgentSessionLog } from '@queries/agent-session/session-fold';
import { COMMAND_PRIORITY_NORMAL, KEY_ENTER_COMMAND } from 'lexical';
import { useContext } from 'solid-js';
import { LexicalWrapperContext } from '../../context/LexicalWrapperContext';
import { autoRegister } from '../../plugins';
import { AgentSessionMentionLabel } from './AgentSessionMentionLabel';

export function AgentSessionMention(props: AgentSessionMentionDecoratorProps) {
  const wrapper = useContext(LexicalWrapperContext);
  const layout = useSplitLayout();
  const query = useAgentSessionMentionPreview(
    () => props.id,
    () => !wrapper?.skipPreviewFetch
  );
  // Guard resource reads: a pending chip must never suspend its editor.
  const preview = () => (query.isSuccess ? query.data.preview : undefined);
  const session = () => {
    const current = preview();
    return current?.access === 'access' ? current.data : undefined;
  };
  const status = createAgentSessionMentionStatus(
    () => session()?.id,
    () => {
      const current = session();
      return current
        ? {
            status: current.status,
            updatedAt: query.isSuccess ? query.data.requestedAt : 0,
          }
        : undefined;
    },
    subscribeAgentSessionLog
  );
  const label = () => {
    const current = preview();
    if (current?.access === 'no_access') return 'Private agent session';
    if (current?.access === 'does_not_exist') return 'Deleted agent session';
    if (query.isError) return 'Agent session unavailable';
    return session()?.name || props.label || 'Agent session';
  };
  const selected = () =>
    wrapper?.selection?.type === 'node' &&
    wrapper.selection.nodeKeys.has(props.key);
  const open = (event: MouseEvent | KeyboardEvent | null) => {
    if (!session()) return;
    layout?.openWithSplit(
      { type: 'agent', id: props.id },
      {
        preferNewSplit: openInNewSplitForMention(
          event?.shiftKey,
          event !== null
        ),
      }
    );
  };
  if (wrapper?.editor)
    autoRegister(
      wrapper.editor.registerCommand(
        KEY_ENTER_COMMAND,
        (event) => {
          if (!selected() || !session()) return false;
          open(event);
          return true;
        },
        COMMAND_PRIORITY_NORMAL
      )
    );
  const navigation = useSplitNavigationHandler<HTMLSpanElement>((event) => {
    event.stopPropagation();
    open(event);
  });
  return (
    <span
      data-agent-session-mention="true"
      data-agent-session-id={props.id}
      data-agent-session-label={label()}
      class="inline-flex max-w-full items-center gap-1 rounded-xs px-1 align-middle text-sm hover:bg-hover"
      classList={{ 'bg-active': selected() }}
      title={[session()?.bot?.name, label()].filter(Boolean).join(' · ')}
      {...navigation}
    >
      <AgentSessionMentionLabel
        label={label()}
        bot={session()?.bot}
        status={session() ? status() : undefined}
      />
    </span>
  );
}
