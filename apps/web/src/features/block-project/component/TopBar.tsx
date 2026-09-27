import {
  ChatWithAgentButton,
  ChatWithAgentIcon,
  openChatWithAgent,
} from '@app/features/chat/ChatWithAgentButton';
import { getIsSpecialProject } from '@block-project/isSpecial';
import { projectBlockDataSignal } from '@block-project/signal/projectBlockData';
import {
  type BlockTool,
  ResponsivePermissionsBadge,
  ToolButton,
} from '@components/app/ResponsiveBlockToolbar';
import {
  BlockSplitFileMenu,
  type FileOperation,
} from '@components/app/split-layout/components/SplitFileMenu';
import {
  SplitHeaderLeft,
  SplitHeaderRight,
} from '@components/app/split-layout/components/SplitHeader';
import {
  BlockItemSplitLabel,
  SplitTitleFileMenu,
} from '@components/app/split-layout/components/SplitLabel';
import {
  SplitToolbarLeft,
  SplitToolbarRight,
} from '@components/app/split-layout/components/SplitToolbar';
import { useBlockId } from '@core/block';
import {
  getShareDrawerRecipientInput,
  ShareTrigger,
} from '@core/component/TopBar/ShareButton';
import { useShareModal } from '@core/component/TopBar/shareModal';
import { ENABLE_PROJECT_SHARING } from '@core/constant/featureFlags';
import { isMobile } from '@core/mobile/isMobile';
import {
  useCanEdit,
  useGetPermissions,
  useIsDocumentOwner,
} from '@core/signal/permissions';
import { buildSimpleEntityUrl } from '@core/util/url';
import { useCopyLink } from '@core/util/useCopyLink';
import IconShared from '@icon/share.svg';
import { createMemo, For, Show } from 'solid-js';
import { ProjectCreateMenu, useProjectCreateTools } from './ProjectCreateMenu';

// TODO (SEAMUS) : Revisit this file when we figure out what we wanna do
//     with folder block.

export function TopBar() {
  const id = useBlockId();
  const isSpecialProject = getIsSpecialProject(id);
  const isOwner = useIsDocumentOwner();
  const canEdit = useCanEdit();
  const name = createMemo(
    () => projectBlockDataSignal()?.projectMetadata.name ?? ''
  );

  const permissions = useGetPermissions();
  const openShare = useShareModal(() => ({
    id,
    blockAlias: 'project',
    itemType: 'project',
    name: name(),
    userPermissions: permissions(),
    owner: projectBlockDataSignal()?.projectMetadata.userId,
  }));
  const copyLink = useCopyLink();
  const handleCopyLink = () =>
    copyLink(buildSimpleEntityUrl({ type: 'project', id }));

  const ops = createMemo<FileOperation[]>(() => [
    ...(isOwner() && !isSpecialProject
      ? [
          { op: 'rename' as const },
          { op: 'moveToProject' as const },
          { op: 'delete' as const },
        ]
      : []),
  ]);

  const { tools: createTools, CreateDialog } = useProjectCreateTools(
    id,
    name,
    canEdit
  );

  const tools: BlockTool[] = [
    {
      label: 'Chat',
      icon: ChatWithAgentIcon,
      action: () => openChatWithAgent({ type: 'project', id, name: name() }),
      condition: () => !isSpecialProject,
      buttonComponent: () => (
        <ChatWithAgentButton entity={{ type: 'project', id, name: name() }} />
      ),
    },
    {
      group: 'sharing',
      label: 'Share',
      icon: IconShared,
      action: openShare,
      condition: () => ENABLE_PROJECT_SHARING && !isSpecialProject,
      buttonComponent: () => (
        <ShareTrigger onClick={openShare} copyLink={handleCopyLink} />
      ),
      focusTarget: getShareDrawerRecipientInput,
    },
  ];
  const toolbarTools = () => tools.filter((tool) => tool.label !== 'Share');
  const showShare = () => ENABLE_PROJECT_SHARING && !isSpecialProject;

  return (
    <>
      <SplitHeaderLeft>
        <BlockItemSplitLabel fallbackName={name()} />
      </SplitHeaderLeft>
      <SplitHeaderRight>
        <div class="order-[1000] flex items-center gap-1">
          <Show when={showShare()}>
            <ShareTrigger onClick={openShare} copyLink={handleCopyLink} />
          </Show>
        </div>
      </SplitHeaderRight>
      <ResponsivePermissionsBadge />
      <SplitTitleFileMenu>
        <BlockSplitFileMenu
          id={id}
          itemType="project"
          name={name()}
          ops={ops()}
          tools={isMobile() ? [...toolbarTools(), ...createTools] : undefined}
        />
      </SplitTitleFileMenu>
      <Show when={!isMobile()}>
        <SplitToolbarLeft class="flex-0">
          <div class="flex gap-2 p-1">
            <Show when={ops().length > 0}>
              <Show when={canEdit()}>
                <ProjectCreateMenu id={id} />
              </Show>
            </Show>
          </div>
        </SplitToolbarLeft>
        <SplitToolbarRight>
          <For each={toolbarTools()}>
            {(tool) => (
              <Show when={!tool.condition || tool.condition()}>
                {tool.buttonComponent ? (
                  <tool.buttonComponent />
                ) : (
                  <ToolButton tool={tool} />
                )}
              </Show>
            )}
          </For>
        </SplitToolbarRight>
      </Show>
      <CreateDialog />
    </>
  );
}
