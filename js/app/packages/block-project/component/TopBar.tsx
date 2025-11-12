import EntityNavigationIndicator from '@app/component/EntityNavigationIndicator';
import {
  type FileOperation,
  SplitFileMenu,
} from '@app/component/split-layout/components/SplitFileMenu';
import {
  SplitHeaderLeft,
  SplitHeaderRight,
} from '@app/component/split-layout/components/SplitHeader';
import {
  BlockItemSplitLabel,
  SplitPermissionsBadge,
} from '@app/component/split-layout/components/SplitLabel';
import {
  SplitToolbarLeft,
  SplitToolbarRight,
} from '@app/component/split-layout/components/SplitToolbar';
import { useIsAuthenticated } from '@core/auth';
import { hasPermissions, Permissions } from '@core/component/SharePermissions';
import { ShareButton } from '@core/component/TopBar/ShareButton';
import { ENABLE_PROJECT_SHARING } from '@core/constant/featureFlags';
import { useGetPermissions } from '@core/signal/permissions';
import { buildSimpleEntityUrl } from '@core/util/url';
import { toast } from 'core/component/Toast/Toast';
import { Show } from 'solid-js';
import { projectSignal } from '../signal/project';
import { ProjectCreateMenu } from './ProjectCreateMenu';
import { ViewSizeSelector } from './ViewSizeSelector';

// TODO (SEAMUS) : Revisit this file when we figure out what we wanna do
//     with folder block.

export function TopBar() {
  const project = projectSignal.get;
  const isAuth = useIsAuthenticated();
  const permissions = useGetPermissions();

  function handleCopyLink() {
    navigator.clipboard.writeText(
      buildSimpleEntityUrl(
        {
          type: 'project',
          id: project()?.id ?? '',
        },
        {}
      )
    );
    toast.success('Link copied to clipboard');
  }

  const ops: FileOperation[] = [
    ...(isAuth() && project()?.id !== 'root' && project()?.id !== 'trash'
      ? [{ op: 'pin' as const }]
      : []),
    ...(hasPermissions(permissions(), Permissions.OWNER) &&
    project()?.id !== 'root' &&
    project()?.id !== 'trash'
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
      <SplitHeaderRight>
        <div class="flex h-full">
          <EntityNavigationIndicator />
        </div>
      </SplitHeaderRight>
      <SplitToolbarLeft class="flex-0">
        <div class="flex gap-2 p-1">
          <Show when={ops.length > 0}>
            <SplitFileMenu
              id={project()?.id ?? ''}
              itemType="project"
              name={project()?.name ?? ''}
              ops={ops}
            />
            <ProjectCreateMenu />
          </Show>
        </div>
      </SplitToolbarLeft>
      <SplitToolbarRight>
        <div class="flex items-center p-1">
          <ViewSizeSelector />
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
                id={project()?.id ?? ''}
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
