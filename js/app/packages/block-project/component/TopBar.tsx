import { useDrawerControl } from '@app/component/split-layout/components/SplitDrawerContext';
import {
  ChatWithAgentButton,
  ChatWithAgentIcon,
  openChatWithAgent,
} from '@app/component/ChatWithAgentButton';
import {
  type BlockTool,
  ResponsivePermissionsBadge,
  ToolButton,
} from '@app/component/ResponsiveBlockToolbar';
import {
  type FileOperation,
  SplitFileMenu,
} from '@app/component/split-layout/components/SplitFileMenu';
import {
  SplitHeaderLeft,
  SplitHeaderRight,
} from '@app/component/split-layout/components/SplitHeader';
import { BlockItemSplitLabel } from '@app/component/split-layout/components/SplitLabel';
import {
  SplitToolbarLeft,
  SplitToolbarRight,
} from '@app/component/split-layout/components/SplitToolbar';
import { useSplitPanelOrThrow } from '@app/component/split-layout/layoutUtils';
import { getIsSpecialProject } from '@block-project/isSpecial';
import { projectBlockDataSignal } from '@block-project/signal/projectBlockData';
import { useBlockId } from '@core/block';
import { DETAILS_DRAWER_ID } from '@core/component/DetailsDrawer';
import {
  ShareTrigger,
  useShareDialogContext,
} from '@core/component/TopBar/ShareButton';
import {
  ENABLE_PROJECT_SHARING,
  ENABLE_PROJECT_VIEW_PREVIEW,
} from '@core/constant/featureFlags';
import { useCanEdit, useIsDocumentOwner } from '@core/signal/permissions';
import { buildSimpleEntityUrl } from '@core/util/url';
import { toast } from 'core/component/Toast/Toast';
import { isMobile } from '@core/mobile/isMobile';
import IconShared from '@macro-icons/wide/share.svg';
import Info from '@icon/regular/info.svg';
import TagIcon from '@icon/regular/tag.svg';
import { createMemo, For, Show } from 'solid-js';
import { ProjectCreateMenu, useProjectCreateTools } from './ProjectCreateMenu';
import {
  ProjectPropertiesButton,
  PROPERTIES_DRAWER_ID,
} from './ProjectPropertiesModal';

// TODO (SEAMUS) : Revisit this file when we figure out what we wanna do
//     with folder block.

export function TopBar() {
  const splitPanelContext = useSplitPanelOrThrow();
  const [preview] = splitPanelContext.previewState;
  const id = useBlockId();
  const isSpecialProject = getIsSpecialProject(id);
  const isOwner = useIsDocumentOwner();
  const canEdit = useCanEdit();
  const name = createMemo(
    () => projectBlockDataSignal()?.projectMetadata.name ?? ''
  );

  const propertiesControl = useDrawerControl(PROPERTIES_DRAWER_ID);
  const detailsControl = useDrawerControl(DETAILS_DRAWER_ID);
  const shareCtx = useShareDialogContext();

  function handleCopyLink() {
    navigator.clipboard.writeText(
      buildSimpleEntityUrl({
        type: 'project',
        id,
      })
    );
    toast.success('Link copied to clipboard');
  }

  const ops = createMemo<FileOperation[]>(() => [
    ...(!isSpecialProject
      ? [
          {
            label: 'Details',
            icon: Info,
            action: detailsControl.toggle,
          },
        ]
      : []),
    ...(isOwner() && !isSpecialProject
      ? [
          { op: 'rename' as const, divideAbove: true },
          { op: 'moveToProject' as const },
          { op: 'delete' as const, divideAbove: true },
        ]
      : []),
  ]);

  const showToolbarRight = () => {
    if (!ENABLE_PROJECT_VIEW_PREVIEW) return true;
    return !preview();
  };

  const { tools: createTools, CreateDialog } = useProjectCreateTools(
    id,
    name,
    canEdit
  );

  const tools: BlockTool[] = [
    {
      label: 'Properties',
      icon: TagIcon,
      action: propertiesControl.toggle,
      condition: () => !isSpecialProject,
      buttonComponent: () => <ProjectPropertiesButton buttonSize="sm" />,
    },
    {
      label: 'Chat',
      icon: ChatWithAgentIcon,
      action: () => openChatWithAgent({ type: 'project', id, name: name() }),
      condition: () => !isSpecialProject,
      divideAbove: true,
      buttonComponent: () => (
        <ChatWithAgentButton entity={{ type: 'project', id, name: name() }} />
      ),
    },
    {
      label: 'Share',
      icon: IconShared,
      action: () => shareCtx.open(),
      condition: () => ENABLE_PROJECT_SHARING && !isSpecialProject,
      buttonComponent: () => <ShareTrigger copyLink={handleCopyLink} />,
    },
  ];

  return (
    <>
      <SplitHeaderLeft>
        <BlockItemSplitLabel fallbackName={name()} />
      </SplitHeaderLeft>
      <ResponsivePermissionsBadge />
      <Show
        when={isMobile()}
        fallback={
          <>
            <SplitToolbarLeft class="flex-0">
              <div class="flex gap-2 p-1">
                <Show when={ops().length > 0}>
                  <SplitFileMenu
                    id={id}
                    itemType="project"
                    name={name()}
                    ops={ops()}
                  />
                  <Show when={canEdit()}>
                    <ProjectCreateMenu id={id} />
                  </Show>
                </Show>
              </div>
            </SplitToolbarLeft>
            <Show when={showToolbarRight()}>
              <SplitToolbarRight>
                <For each={tools}>
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
          </>
        }
      >
        {/* Mobile layout */}
        <SplitHeaderRight>
          <Show when={ops().length > 0 || !isSpecialProject}>
            <SplitFileMenu
              id={id}
              itemType="project"
              name={name()}
              ops={ops()}
              tools={[...tools, ...createTools]}
            />
          </Show>
        </SplitHeaderRight>
      </Show>
      <CreateDialog />
    </>
  );
}
