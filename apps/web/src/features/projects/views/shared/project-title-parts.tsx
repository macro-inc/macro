import type { BlockTool } from '@components/app/block-tool';
import { SplitFileMenu } from '@components/app/split-layout/components/SplitFileMenu';
import {
  SplitTitleFileMenu,
  titleFileMenuMount,
} from '@components/app/split-layout/components/SplitLabel';
import { useSplitPanelOrThrow } from '@components/app/split-layout/layoutUtils';
import { EntityIcon } from '@core/component/EntityIcon';
import { Permissions } from '@core/component/SharePermissions';
import type { ProjectDetail } from '../../core/project';

const PROJECT_PERMISSIONS: Record<ProjectDetail['access'], Permissions> = {
  owner: Permissions.OWNER,
  edit: Permissions.CAN_EDIT,
  comment: Permissions.CAN_COMMENT,
  view: Permissions.CAN_VIEW,
};

export function ProjectTitleLabel(props: { project: ProjectDetail }) {
  const panel = useSplitPanelOrThrow();
  return (
    <>
      <EntityIcon
        targetType="initiative"
        appearance={props.project.appearance}
        size="xs"
      />
      <span class="truncate text-sm font-semibold">{props.project.name}</span>
      <div class="flex shrink-0 items-center" ref={titleFileMenuMount(panel)} />
    </>
  );
}

export function ProjectTitleActions(props: {
  project: ProjectDetail;
  tools: BlockTool[];
}) {
  return (
    <SplitTitleFileMenu>
      <SplitFileMenu
        id={props.project.id}
        itemType="initiative"
        entityKind="initiative"
        name={props.project.name}
        permissions={PROJECT_PERMISSIONS[props.project.access]}
        entity={{
          type: 'initiative',
          id: props.project.id,
          name: props.project.name,
          ownerId: props.project.ownerId,
          appearance: props.project.appearance,
        }}
        triggerLabel="Project actions"
        ops={[]}
        tools={props.tools}
      />
    </SplitTitleFileMenu>
  );
}
