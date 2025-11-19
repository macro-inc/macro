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
import { getIsSpecialProject } from '@block-project/isSpecial';
import { useIsAuthenticated } from '@core/auth';
import { useBlockId } from '@core/block';
import { hasPermissions, Permissions } from '@core/component/SharePermissions';
import { ShareButton } from '@core/component/TopBar/ShareButton';
import { ENABLE_PROJECT_SHARING } from '@core/constant/featureFlags';
import { useCanEdit, useGetPermissions } from '@core/signal/permissions';
import { buildSimpleEntityUrl } from '@core/util/url';
import { toast } from 'core/component/Toast/Toast';
import { Show } from 'solid-js';
import { projectSignal } from '../signal/project';
import { ProjectCreateMenu } from './ProjectCreateMenu';

// TODO (SEAMUS) : Revisit this file when we figure out what we wanna do
//     with folder block.

export function TopBar() {
  const project = projectSignal.get;
  const id = useBlockId();
  const isSpecialProject = getIsSpecialProject(id);
  const isAuth = useIsAuthenticated();
  const permissions = useGetPermissions();
  const canEdit = useCanEdit();

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

  const ops: FileOperation[] = [
    ...(isAuth() && !isSpecialProject ? [{ op: 'pin' as const }] : []),
    ...(hasPermissions(permissions(), Permissions.OWNER) && !isSpecialProject
      ? [
          { op: 'rename' as const },
          { op: 'moveToProject' as const },
          { op: 'delete' as const, divideAbove: true },
        ]
      : []),
  ];

  return (
    <>
      <SplitHeaderLeft>
        <BlockItemSplitLabel fallbackName={project()?.name} />
      </SplitHeaderLeft>
      <SplitToolbarLeft class="flex-0">
        <div class="flex gap-2 p-1">
          <Show when={ops.length > 0}>
            <SplitFileMenu
              id={id}
              itemType="project"
              name={project()?.name ?? ''}
              ops={ops}
            />
            <Show when={canEdit()}>
              <ProjectCreateMenu />
            </Show>
          </Show>
        </div>
      </SplitToolbarLeft>
      <SplitToolbarRight>
        <div class="flex items-center p-1">
          <div class="flex items-center">
            <SplitPermissionsBadge />
            <Show
              when={
                ENABLE_PROJECT_SHARING &&
                project()?.id !== 'trash' &&
                project()?.id !== 'root'
              }
            >
              <ShareButton
                id={id}
                name={project()?.name ?? ''}
                userPermissions={permissions()}
                copyLink={handleCopyLink}
                itemType="project"
                owner={project()?.userId}
              />
            </Show>
          </div>
        </div>
      </SplitToolbarRight>
    </>
  );
}
