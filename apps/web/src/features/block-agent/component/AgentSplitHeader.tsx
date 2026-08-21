import {
  type BlockTool,
  ResponsiveBlockToolbar,
  ToolButton,
} from '@components/app/ResponsiveBlockToolbar';
import { useDrawerControl } from '@components/app/split-layout/components/SplitDrawerContext';
import type { FileOperation } from '@components/app/split-layout/components/SplitFileMenu';
import {
  SplitHeaderLeft,
  SplitHeaderRight,
} from '@components/app/split-layout/components/SplitHeader';
import { StaticSplitLabel } from '@components/app/split-layout/components/SplitLabel';
import { toast } from '@core/component/Toast/Toast';
import { isMobile } from '@core/mobile/isMobile';
import { buildSimpleEntityUrl, openExternalUrl } from '@core/util/url';
import GitBranch from '@phosphor/git-branch.svg';
import LinkIcon from '@phosphor/link.svg';
import TreeStructure from '@phosphor/tree-structure.svg';
import type { AgentSessionResponse } from '@service-agent-harness/generated/schemas';
import { For, Show } from 'solid-js';
import { useAgentSession } from '../context/AgentSessionContext';
import {
  ORIGIN_THREAD_DRAWER_ID,
  sessionOriginThread,
} from '../context/origin-thread';

/** 'claude-code' → 'Claude Code'; the fallback when the fold has no title. */
export function harnessTitle(harness: string | undefined): string {
  if (!harness) return 'Agent session';
  return harness
    .split(/[-_]/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

/**
 * Agent-session identity in the split header chrome plus the standard split
 * toolbar, matching the PR block's shape for non-document blocks: static
 * label (names the split tab), copy-link tool, and a file menu with the
 * session's repository.
 */
export function AgentSplitHeader(props: {
  session: AgentSessionResponse | undefined;
  /** The fold's session title, preferred over the harness fallback. */
  title?: string;
}) {
  // The session, not `useBlockId()`: a block created from the launcher mounts
  // against a placeholder and keeps reporting it (see `Block.tsx`), so the
  // block id is the one thing here that is not a shareable session id.
  const { sessionId } = useAgentSession();
  const title = () => props.title ?? harnessTitle(props.session?.harness);
  const originThreadDrawer = useDrawerControl(ORIGIN_THREAD_DRAWER_ID);

  const copyLink = async () => {
    const id = sessionId();
    if (!id) return;
    await navigator.clipboard.writeText(
      buildSimpleEntityUrl({ type: 'agent', id })
    );
    toast.success('Link copied to clipboard');
  };

  const tools: BlockTool[] = [
    {
      label: 'Discussion Thread',
      icon: TreeStructure,
      action: originThreadDrawer.toggle,
      isActive: originThreadDrawer.isOpen,
      condition: () => sessionOriginThread(props.session) !== undefined,
    },
    {
      label: 'Copy link',
      icon: LinkIcon,
      action: copyLink,
      // Nothing to link to until the session exists.
      condition: () => sessionId() !== undefined,
    },
  ];

  const ops: FileOperation[] = [
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
    <>
      <SplitHeaderLeft>
        <StaticSplitLabel iconType="agent" label={title()} />
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

      <ResponsiveBlockToolbar
        tools={[]}
        menuTools={tools}
        ops={ops}
        id={sessionId() ?? ''}
        itemType="foreign"
        name={title()}
      />
    </>
  );
}
