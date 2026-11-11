import { MobileHeader } from '@components/app/mobile-header/mobile-header';
import { BlockSplitFileMenu } from '@components/app/split-layout/components/SplitFileMenu';
import { ProviderIcon } from '@core/component/AI/component/ProviderIcon';
import { BlockLiveIndicators } from '@core/component/LiveIndicators';
import type { AgentSessionResponse } from '@service-agent-harness/generated/schemas';
import { Show } from 'solid-js';
import { AgentPullRequestChip } from '../component/AgentPullRequestChip';
import { AgentTaskChip } from '../component/AgentTaskChip';
import type { AgentSessionHeaderState } from '../component/agent-session-header';
import { useAgentSession } from '../context/AgentSessionContext';

/**
 * The agent session block's header on touch, where every session opens as
 * this block: the title with its menu, live viewers, the session's task and
 * pull request, and Info.
 */
export function MobileAgentSessionHeader(props: {
  session: AgentSessionResponse | undefined;
  header: AgentSessionHeaderState;
}) {
  const { sessionId, metadata } = useAgentSession();
  const { actions } = props.header;

  return (
    <>
      <MobileHeader
        trailing={
          <>
            <Show when={props.session && sessionId()}>
              {(id) => (
                <MobileHeader.Island>
                  <BlockLiveIndicators entityId={id} />
                </MobileHeader.Island>
              )}
            </Show>
            <div class="flex items-center gap-1.5">
              <Show when={props.session?.taskId}>
                {(taskId) => <AgentTaskChip taskId={taskId()} />}
              </Show>
              <Show when={props.session?.pullRequestUrl}>
                {(url) => <AgentPullRequestChip url={url()} />}
              </Show>
            </div>
            <MobileHeader.Info />
          </>
        }
      >
        <MobileHeader.Title
          icon={
            <ProviderIcon
              model={metadata()?.model ?? props.session?.model}
              class="size-4 shrink-0"
            />
          }
          label={props.header.title()}
        />
      </MobileHeader>

      <BlockSplitFileMenu
        id={sessionId() ?? ''}
        itemType="agent_session"
        name={props.header.title()}
        ops={props.header.ops()}
        tools={[actions.openExternally, actions.share]}
        entity={props.header.entity()}
        permissions={props.header.permissions()}
      />
    </>
  );
}
