import { useBlockEntityCommands } from '@app/features/next-soup/actions/use-block-entity-commands';
import {
  type BlockTool,
  ResponsiveBlockToolbar,
  ToolButton,
} from '@components/app/ResponsiveBlockToolbar';
import type { FileOperation } from '@components/app/split-layout/components/SplitFileMenu';
import {
  SplitHeaderLeft,
  SplitHeaderRight,
} from '@components/app/split-layout/components/SplitHeader';
import { StaticSplitLabel } from '@components/app/split-layout/components/SplitLabel';
import { ProviderIcon } from '@core/component/AI/component/ProviderIcon';
import { Permissions } from '@core/component/SharePermissions';
import {
  ShareDialogContext,
  ShareModal,
  ShareTrigger,
} from '@core/component/TopBar/ShareButton';
import { isMobile } from '@core/mobile/isMobile';
import { openExternalUrl } from '@core/util/url';
import type { AgentSessionEntity } from '@entity';
import ArrowSquareOut from '@phosphor/arrow-square-out.svg';
import GitBranch from '@phosphor/git-branch.svg';
import ShareIcon from '@phosphor/share.svg';
import type { AgentSessionResponse } from '@service-agent-harness/generated/schemas';
import { createSignal, For, Show, Suspense } from 'solid-js';
import { useAgentSession } from '../context/AgentSessionContext';
import { harnessTitle } from './compose-agent-session-options';

export { harnessTitle };

/**
 * Agent-session identity in the split header chrome plus the standard split
 * toolbar: static label, shared entity actions, and session-specific
 * repository and external-provider links.
 *
 * Rename lives on the title menu (channel / automation), not on a tap of
 * the name — `StaticSplitLabel` without `onRename` so a touch tap opens
 * the dropdown instead of an inline editor.
 */
export function AgentSplitHeader(props: {
  session: AgentSessionResponse | undefined;
  /** The fold's session title, preferred over the harness fallback. */
  title?: string;
}) {
  // The session, not `useBlockId()`: a block created from the launcher mounts
  // against a placeholder and keeps reporting it (see `Block.tsx`), so the
  // block id is the one thing here that is not a shareable session id.
  const { sessionId, metadata } = useAgentSession();
  const title = () => {
    const persistedName = props.session?.name;
    if (persistedName && persistedName !== 'Agent Session')
      return persistedName;
    return props.title ?? persistedName ?? harnessTitle(props.session?.harness);
  };

  const entity = (): AgentSessionEntity | undefined => {
    const session = props.session;
    const id = sessionId();
    if (!session || !id) return undefined;
    return {
      type: 'agent_session',
      id,
      name: title(),
      ownerId: session.ownerId,
      botId: session.botId,
      status:
        session.status.kind === 'event'
          ? session.status.event
          : session.status.kind,
    };
  };
  useBlockEntityCommands(entity);
  const [shareOpen, setShareOpen] = createSignal(false);
  const shareContext = {
    isOpen: shareOpen,
    open: () => setShareOpen(true),
    close: () => setShareOpen(false),
  };

  const shareTools: BlockTool[] = [
    {
      label: 'Share',
      icon: ShareIcon,
      action: () => setShareOpen(true),
      condition: () => Boolean(entity()),
      buttonComponent: () => <ShareTrigger id={sessionId()} />,
    },
  ];

  const tools: BlockTool[] = [
    {
      label: () => {
        const provider = props.session?.external?.provider;
        if (!provider) return 'Open externally';
        return `Open in ${provider.charAt(0).toUpperCase()}${provider.slice(1)}`;
      },
      icon: ArrowSquareOut,
      action: () => {
        const url = props.session?.external?.url;
        if (url) openExternalUrl(url);
      },
      condition: () => Boolean(props.session?.external?.url),
    },
  ];

  const ops: FileOperation[] = [
    { op: 'rename' },
    { op: 'delete' },
    {
      label: 'Open repository',
      icon: GitBranch,
      action: () => {
        const url = props.session?.repoUrl;
        if (url) openExternalUrl(url);
      },
    },
  ];

  return (
    <ShareDialogContext.Provider value={shareContext}>
      <SplitHeaderLeft>
        <StaticSplitLabel
          icon={
            <ProviderIcon
              model={metadata()?.model ?? props.session?.model}
              class="size-4 shrink-0"
            />
          }
          label={title()}
        />
      </SplitHeaderLeft>

      {/* Tools live on the header row itself — `ResponsiveBlockToolbar`
          would push non-Share tools onto a second toolbar row. Markup
          mirrors its own header-tools branch; on mobile the tools collapse
          into the title menu via `menuTools` below instead. */}
      <Show when={!isMobile()}>
        <SplitHeaderRight>
          <div class="order-[1000] flex items-center gap-1">
            <For each={tools}>
              {(tool) => (
                <Show when={!tool.condition || tool.condition()}>
                  <ToolButton tool={tool} />
                </Show>
              )}
            </For>
          </div>
        </SplitHeaderRight>
      </Show>

      <Show when={entity()}>
        {(session) => (
          <Suspense>
            <ShareModal
              id={session().id}
              name={title()}
              owner={session().ownerId}
              itemType="agent_session"
              blockAlias="agent"
              userPermissions={Permissions.OWNER}
              isSharePermOpen={shareOpen()}
              setIsSharePermOpen={setShareOpen}
            />
          </Suspense>
        )}
      </Show>

      <ResponsiveBlockToolbar
        tools={shareTools}
        menuTools={tools}
        ops={entity() ? ops : []}
        id={sessionId() ?? ''}
        itemType="agent_session"
        entity={entity()}
        name={title()}
      />
    </ShareDialogContext.Provider>
  );
}
