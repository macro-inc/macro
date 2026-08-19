import {
  ChatWithAgentButton,
  ChatWithAgentIcon,
  openChatWithAgent,
} from '@app/features/chat/ChatWithAgentButton';
import { useDownloadDocumentAsMarkdownText } from '@block-md/signal/save';
import {
  type BlockTool,
  ResponsiveBlockToolbar,
  ResponsivePermissionsBadge,
} from '@components/app/ResponsiveBlockToolbar';
import { useSidePanel } from '@components/app/side-panel';
import type { FileOperation } from '@components/app/split-layout/components/SplitFileMenu';
import {
  SplitHeaderLeft,
  SplitHeaderRight,
} from '@components/app/split-layout/components/SplitHeader';
import {
  BlockItemSplitLabel,
  StaticSplitLabel,
} from '@components/app/split-layout/components/SplitLabel';
import { useSplitPanel } from '@components/app/split-layout/layoutUtils';
import { useBlockAliasedName, useBlockId, useBlockName } from '@core/block';
import { BlockLiveIndicators } from '@core/component/LiveIndicators';
import {
  getShareDrawerRecipientInput,
  ShareTrigger,
  useShareDialogContext,
} from '@core/component/TopBar/ShareButton';
import { registerHotkey } from '@core/hotkey/hotkeys';
import { TOKENS } from '@core/hotkey/tokens';
import { isMobile } from '@core/mobile/isMobile';
import { blockHotkeyScopeSignal } from '@core/signal/blockElement';
import { copyBranchNameToClipboard } from '@core/util/branchName';
import { useBlockDocumentName } from '@core/util/currentBlockDocumentName';
import Download from '@phosphor/download.svg';
import GitBranch from '@phosphor/git-branch.svg';
import IconLink from '@phosphor/link.svg';
import TerminalWindowIcon from '@phosphor/terminal-window.svg';
import { blockNameToItemType } from '@service-storage/client';
import { type Accessor, createEffect, on, onCleanup, Show } from 'solid-js';
import { useHistory } from '../history/HistoryContext';
import {
  DispatchAgentButton,
  useDispatchAgentSplitFileActions,
} from './DispatchAgentMenu';

export function TopBar(props: { name?: Accessor<string | undefined> } = {}) {
  const blockName = useBlockName();
  const blockId = useBlockId();
  const scopeId = blockHotkeyScopeSignal.get;
  const fallbackName = useBlockDocumentName();
  const name = () => props.name?.() ?? fallbackName();
  const itemType = blockNameToItemType(blockName);
  if (!itemType)
    throw new Error('Using functionality in an unknown item type.');

  const downloadAsMarkdownText = useDownloadDocumentAsMarkdownText();

  const shareCtx = useShareDialogContext();
  const blockAliasedName = useBlockAliasedName();
  const isTask = blockAliasedName === 'task';
  const isSkill = blockAliasedName === 'skill';
  const dispatchAgentActions = useDispatchAgentSplitFileActions();

  const copyBranchName = () => copyBranchNameToClipboard(blockId);

  if (isTask) {
    let cleanupKbShortcut = () => {};

    createEffect(
      on(scopeId, (id) => {
        cleanupKbShortcut();
        registerHotkey({
          hotkey: 'shift+cmd+b',
          scopeId: id,
          hotkeyToken: TOKENS.entity.action.copyBranchName,
          description: 'Copy branch name',
          keyDownHandler: () => {
            copyBranchName();
            return true;
          },
          runWithInputFocused: true,
        });
      })
    );
  }

  const ops: FileOperation[] = [
    { op: 'copy' },
    { op: 'rename' },
    { op: 'moveToProject' },
    ...(isTask
      ? ([
          {
            group: 'sharing' as const,
            label: 'Copy Branch Name',
            icon: GitBranch,
            action: copyBranchName,
          },
        ] satisfies FileOperation[])
      : []),
    {
      group: 'file',
      label: 'Download',
      icon: Download,
      action: downloadAsMarkdownText,
    },
    { op: 'delete' },
  ];

  const sidePanel = useSidePanel();
  const splitPanel = useSplitPanel();
  const _history = useHistory();

  // Register at the split scope so `]` works from anywhere in the split
  // (header, toolbar, drawer), but tie disposal to this TopBar so the
  // registration disappears with the block.
  if (splitPanel?.splitHotkeyScope) {
    const reg = registerHotkey({
      hotkey: ']',
      scopeId: splitPanel.splitHotkeyScope,
      hotkeyToken: TOKENS.block.toggleSidePanel,
      description: 'Toggle Side Panel',
      keyDownHandler: () => {
        if (!sidePanel) return false;
        if (!sidePanel.hasSections()) return false;
        sidePanel.toggle();
        return true;
      },
    });
    onCleanup(() => reg.dispose());
  }

  const tools: BlockTool[] = [
    // {
    //   label: 'Copy Branch Name',
    //   icon: GitBranch,
    //   action: copyBranchName,
    //   condition: () => isTask,
    //   hotkeyToken: TOKENS.entity.action.copyBranchName,
    // },
    {
      label: 'Dispatch to Agent',
      icon: TerminalWindowIcon,
      action: () => {},
      condition: () => isTask && !isMobile(),
      buttonComponent: () => <DispatchAgentButton />,
    },
    {
      label: 'Chat',
      icon: ChatWithAgentIcon,
      action: () =>
        openChatWithAgent({
          type: 'document',
          id: blockId,
          name: name(),
          fileType: 'md',
        }),
      buttonComponent: () => (
        <ChatWithAgentButton
          entity={{
            type: 'document',
            id: blockId,
            name: name(),
            fileType: 'md',
          }}
        />
      ),
    },
    {
      group: 'sharing',
      label: 'Share',
      icon: IconLink,
      action: () => shareCtx.open(),
      buttonComponent: () => <ShareTrigger />,
      focusTarget: getShareDrawerRecipientInput,
    },
  ];

  const menuTools: BlockTool[] = [
    {
      label: 'Ask Macro',
      icon: ChatWithAgentIcon,
      action: () =>
        openChatWithAgent({
          type: 'document',
          id: blockId,
          name: name(),
          fileType: 'md',
        }),
    },
    ...(isTask
      ? ([
          {
            label: 'Code Actions',
            icon: TerminalWindowIcon,
            action: () => {},
            children: dispatchAgentActions,
          },
        ] satisfies BlockTool[])
      : []),
  ];

  return (
    <>
      <SplitHeaderLeft>
        <BlockItemSplitLabel name={name} />
        <Show when={isSkill}>
          <span class="ml-1.5 inline-flex shrink-0 items-center self-center rounded-sm bg-hover px-1.5 py-0.5 text-[10px] font-medium leading-none text-ink-muted">
            Skill
          </span>
        </Show>
      </SplitHeaderLeft>

      <SplitHeaderRight>
        {/* Hidden on mobile/tablet: no floating-island treatment for live avatars yet. */}
        <div class="-order-1 touch:hidden">
          <BlockLiveIndicators />
        </div>
      </SplitHeaderRight>

      <ResponsivePermissionsBadge />

      <ResponsiveBlockToolbar
        tools={tools}
        menuTools={menuTools}
        ops={ops}
        id={blockId}
        itemType={itemType}
        name={name()}
      />
    </>
  );
}

export function InstructionsTopBar() {
  return (
    <SplitHeaderLeft>
      <StaticSplitLabel label="AI Instructions" iconType="md" />
    </SplitHeaderLeft>
  );
}
