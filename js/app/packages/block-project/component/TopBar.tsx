import {
  type FileOperation,
  SplitFileMenu,
} from '@app/component/split-layout/components/SplitFileMenu';
import { SplitHeaderLeft } from '@app/component/split-layout/components/SplitHeader';
import {
  BlockItemSplitLabel,
  SplitPermissionsBadge,
} from '@app/component/split-layout/components/SplitLabel';
import {
  SplitToolbarLeft,
  SplitToolbarRight,
} from '@app/component/split-layout/components/SplitToolbar';
import { useSplitPanelOrThrow } from '@app/component/split-layout/layoutUtils';
import { getIsSpecialProject } from '@block-project/isSpecial';
import { projectBlockDataSignal } from '@block-project/signal/projectBlockData';
import { useBlockId } from '@core/block';
import { ShareButton } from '@core/component/TopBar/ShareButton';
import {
  ENABLE_PROJECT_SHARING,
  ENABLE_PROJECT_VIEW_PREVIEW,
} from '@core/constant/featureFlags';
import {
  useCanEdit,
  useGetPermissions,
  useIsDocumentOwner,
} from '@core/signal/permissions';
import { buildSimpleEntityUrl } from '@core/util/url';
import { toast } from 'core/component/Toast/Toast';
import { createMemo, Show } from 'solid-js';
import { ProjectCreateMenu } from './ProjectCreateMenu';
import { ProjectPropertiesModal } from './ProjectPropertiesModal';

// TODO (SEAMUS) : Revisit this file when we figure out what we wanna do
//     with folder block.

export function TopBar() {
  const splitPanelContext = useSplitPanelOrThrow();
  const [preview] = splitPanelContext.previewState;
  const id = useBlockId();
  const isSpecialProject = getIsSpecialProject(id);
  const permissions = useGetPermissions();
  const isOwner = useIsDocumentOwner();
  const canEdit = useCanEdit();
  const name = () => projectBlockDataSignal()?.projectMetadata.name ?? '';
  const owner = () => projectBlockDataSignal()?.projectMetadata.userId;

  function handleCopyLink() {
    navigator.clipboard.writeText(
      buildSimpleEntityUrl(
        {
          type: 'project',
          id,
        },
        {}
      )
    );
    toast.success('Link copied to clipboard');
  }

  const ops = createMemo<FileOperation[]>(() => [
    ...(isOwner() && !isSpecialProject
      ? [
          { op: 'rename' as const },
          { op: 'moveToProject' as const },
          { op: 'delete' as const, divideAbove: true },
        ]
      : []),
  ]);

  const showToolbarRight = () => {
    if (!ENABLE_PROJECT_VIEW_PREVIEW) return true;
    return !preview();
  };

  return (
    <>
      <SplitHeaderLeft>
        <BlockItemSplitLabel fallbackName={name()} />
      </SplitHeaderLeft>
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
          <div class="flex items-center p-1">
            <div class="flex items-center">
              <Show when={!isSpecialProject}>
                <ProjectPropertiesModal buttonSize="sm" name={name()} />
              </Show>
              <SplitPermissionsBadge />
              <Show when={ENABLE_PROJECT_SHARING && !isSpecialProject}>
                <ShareButton
                  id={id}
                  name={name()}
                  userPermissions={permissions()}
                  copyLink={handleCopyLink}
                  itemType="project"
                  owner={owner()}
                />
              </Show>
            </div>
          </div>
        </SplitToolbarRight>
      </Show>
    </>
  );
}
