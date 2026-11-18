import { ChangesToggle } from '@app/features/changes/changes';
import { BlockToolbar } from '@components/app/block-toolbar';
import { HeaderActionGroup } from '@components/app/HeaderActionGroup';
import {
  SplitHeaderLeft,
  SplitHeaderRight,
} from '@components/app/split-layout/components/SplitHeader';
import { StaticSplitLabel } from '@components/app/split-layout/components/SplitLabel';
import { ToolButton } from '@components/app/tool-button';
import { ProviderIcon } from '@core/component/AI/component/ProviderIcon';
import { BlockLiveIndicators } from '@core/component/LiveIndicators';
import { ShareTrigger } from '@core/component/TopBar/ShareButton';
import type { AgentSessionResponse } from '@service-agent-harness/generated/schemas';
import { Show } from 'solid-js';
import { AgentPullRequestChip } from '../component/AgentPullRequestChip';
import { AgentTaskChip } from '../component/AgentTaskChip';
import type { AgentSessionHeaderState } from '../component/agent-session-header';
import { useAgentSession } from '../context/AgentSessionContext';

/**
 * The agent session block's header on desktop: the session's identity, its
 * live viewers, task and pull request, Changes, its external link and Share.
 */
export function AgentSessionHeader(props: {
  session: AgentSessionResponse | undefined;
  header: AgentSessionHeaderState;
}) {
  const { sessionId, metadata } = useAgentSession();
  const { actions } = props.header;

  return (
    <>
      <SplitHeaderLeft>
        <StaticSplitLabel
          icon={
            <ProviderIcon
              model={metadata()?.model ?? props.session?.model}
              class="size-4 shrink-0"
            />
          }
          label={props.header.title()}
        />
      </SplitHeaderLeft>

      {/* Session context stays next to the grouped header actions. */}
      <SplitHeaderRight>
        <Show when={props.session && sessionId()}>
          {(id) => <BlockLiveIndicators entityId={id} />}
        </Show>
        <div class="order-[900] flex items-center gap-2">
          <Show when={props.session?.taskId}>
            {(taskId) => <AgentTaskChip taskId={taskId()} />}
          </Show>
          <Show when={props.session?.pullRequestUrl}>
            {(url) => <AgentPullRequestChip url={url()} />}
          </Show>
          <ChangesToggle />
          <HeaderActionGroup label="Session actions">
            <Show when={actions.openExternally.condition?.()}>
              <ToolButton tool={actions.openExternally} grouped />
            </Show>
          </HeaderActionGroup>
        </div>
      </SplitHeaderRight>

      <BlockToolbar
        trailing={
          <Show when={props.header.entity()}>
            <ShareTrigger onClick={props.header.openShare} id={sessionId()} />
          </Show>
        }
        menuTools={[actions.openExternally, actions.share]}
        ops={props.header.ops()}
        id={sessionId() ?? ''}
        itemType="agent_session"
        entity={props.header.entity()}
        permissions={props.header.permissions()}
        name={props.header.title()}
      />
    </>
  );
}
