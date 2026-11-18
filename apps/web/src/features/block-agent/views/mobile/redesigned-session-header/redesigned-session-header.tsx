import { conversationCodeDetails } from '@app/features/agents-view/queries/conversation-code-details';
import { createSessionCodeDetailsSource } from '@app/features/agents-view/queries/session-code-details';
import { CodeDetailsContent } from '@app/features/agents-view/views/shared/code-details-drawer/content';
import type { CodeDetailsActions } from '@app/features/agents-view/views/shared/code-details-drawer/context';
import { CodeDetailsRoot } from '@app/features/agents-view/views/shared/code-details-drawer/root';
import { CodeDetailsTrigger } from '@app/features/agents-view/views/shared/code-details-drawer/trigger';
import { t } from '@app/lib/i18n';
import { MobileHeader } from '@components/app/mobile-header/mobile-header';
import { SplitFileMenu } from '@components/app/split-layout/components/SplitFileMenu';
import { useSplitLayout } from '@components/app/split-layout/layout';
import { ProviderIcon } from '@core/component/AI/component/ProviderIcon';
import { BlockLiveIndicators } from '@core/component/LiveIndicators';
import { toast } from '@core/component/Toast/Toast';
import { writeClipboardData } from '@core/util/dataTransfer';
import { openExternalUrl } from '@core/util/url';
import type { AgentSessionResponse } from '@service-agent-harness/generated/schemas';
import { Show } from 'solid-js';
import type { AgentSessionHeaderState } from '../../../component/agent-session-header';
import { useAgentSession } from '../../../context/AgentSessionContext';
import { sessionActionGroups } from '../../../core/session-action-groups';

/** The session header shares code details and actions with phone list rows. */
export function MobileAgentSessionHeader(props: {
  session: AgentSessionResponse | undefined;
  header: AgentSessionHeaderState;
  onDelete?: () => void;
}) {
  const { sessionId, metadata } = useAgentSession();
  const layout = useSplitLayout();
  const codeSource = createSessionCodeDetailsSource(
    sessionId,
    () => props.session?.ownerId
  );
  const details = () => {
    const entity = props.header.entity();
    if (!entity) return undefined;
    const cached = codeSource();
    const current = conversationCodeDetails({
      ...entity,
      repoUrl: props.session?.repoUrl,
      pullRequestUrl: props.session?.pullRequestUrl,
    });
    const samePullRequest =
      current?.pullRequest?.url === cached?.pullRequest?.url;
    const pullRequest = current?.pullRequest
      ? {
          ...current.pullRequest,
          ...(samePullRequest ? cached?.pullRequest : {}),
        }
      : undefined;
    if (!pullRequest && !cached?.branch) return undefined;
    return {
      repository: current?.repository ?? cached?.repository,
      branch: cached?.branch,
      pullRequest,
    };
  };
  const actions: CodeDetailsActions = {
    openPullRequest: (pr) => {
      if (pr.id)
        layout.openWithSplit(
          { type: 'pr', id: pr.id },
          { referredFrom: 'agents' }
        );
      else openExternalUrl(pr.url);
    },
    openBranch: openExternalUrl,
    copyBranch: async (branch) => {
      const copied = await writeClipboardData({ 'text/plain': branch });
      if (!copied)
        toast.failure(t('entityActions.toastCopyFailed', { count: 1 }));
      return copied;
    },
  };
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
            <MobileHeader.Info />
          </>
        }
      >
        <MobileHeader.Title
          weight="normal"
          label={props.header.title()}
          icon={
            <Show
              when={details()}
              fallback={
                <ProviderIcon
                  model={metadata()?.model ?? props.session?.model}
                  class="size-4 shrink-0"
                />
              }
            >
              {(code) => (
                <CodeDetailsRoot details={code()} actions={actions}>
                  <CodeDetailsTrigger class="-mx-2 size-9" />
                  <CodeDetailsContent />
                </CodeDetailsRoot>
              )}
            </Show>
          }
        />
      </MobileHeader>
      <SplitFileMenu
        id={sessionId() ?? ''}
        itemType="agent_session"
        entityKind="agent"
        name={props.header.title()}
        ops={props.header.ops()}
        tools={[
          props.header.actions.openExternally,
          props.header.actions.share,
        ]}
        mobileActionGroups={(groups) => {
          const index = props.header
            .ops()
            .findIndex(
              (operation) => 'op' in operation && operation.op === 'rename'
            );
          return sessionActionGroups(
            groups,
            index < 0 ? undefined : `operation-${index}`
          );
        }}
        entity={props.header.entity()}
        permissions={props.header.permissions()}
        onDelete={props.onDelete}
      />
    </>
  );
}
