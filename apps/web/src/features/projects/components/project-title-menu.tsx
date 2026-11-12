import { t } from '@app/lib/i18n';
import { globalSplitManager } from '@app/signal/splitLayout';
import type { BlockTool } from '@components/app/ResponsiveBlockToolbar';
import { HeaderIsland } from '@components/app/split-layout/components/HeaderIsland';
import { SplitFileMenu } from '@components/app/split-layout/components/SplitFileMenu';
import {
  SplitTitleFileMenu,
  titleFileMenuMount,
} from '@components/app/split-layout/components/SplitLabel';
import { useSplitLayout } from '@components/app/split-layout/layout';
import { useSplitPanelOrThrow } from '@components/app/split-layout/layoutUtils';
import { EntityIcon } from '@core/component/EntityIcon';
import { Permissions } from '@core/component/SharePermissions';
import { toast } from '@core/component/Toast/Toast';
import { isMobile } from '@core/mobile/isMobile';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { fireAndForget } from '@core/util/fireAndForget';
import CaretDownIcon from '@icon/system/regular/caret-down.svg';
import PriorityIcon from '@icon/system/regular/chart-bar.svg';
import StatusIcon from '@icon/system/regular/circle-dashed.svg';
import RenameIcon from '@icon/system/regular/note-pencil.svg';
import ShareIcon from '@icon/system/regular/share-network.svg';
import SquaresFourIcon from '@icon/system/regular/squares-four.svg';
import TrashIcon from '@icon/system/regular/trash.svg';
import { SYSTEM_PROPERTY_IDS } from '@property/identifiers';
import type { Property } from '@property/types';
import { formatOptionValue } from '@property/utils/formatting';
import { createSignal, Show } from 'solid-js';
import {
  type ProjectSource,
  type ProjectsContext,
  useProjectsContext,
} from '../context/projects-context';
import {
  canDeleteProject,
  canEditProject,
  type ProjectDetail,
  type ProjectSection,
} from '../core/project';
import { openProject } from '../open-project';
import { DeleteProjectsDialog } from './delete-projects-dialog';
import { RenameProjectDialog } from './rename-project-dialog';

const PROJECT_PERMISSIONS: Record<ProjectDetail['access'], Permissions> = {
  owner: Permissions.OWNER,
  edit: Permissions.CAN_EDIT,
  comment: Permissions.CAN_COMMENT,
  view: Permissions.CAN_VIEW,
};

export function ProjectTitleMenu(props: {
  project: ProjectDetail;
  source: ProjectSource;
  commands: ReturnType<ProjectsContext['createCommands']>;
  section: ProjectSection;
  onShare(): void;
  onDelete(): void;
}) {
  const definitions = useProjectsContext().createPropertyDefinitionsSource();
  const layout = useSplitLayout();
  const panel = useSplitPanelOrThrow();
  const [renaming, setRenaming] = createSignal(false);
  const [deleting, setDeleting] = createSignal(false);
  const [error, setError] = createSignal<string>();
  const definition = (id: string) =>
    definitions
      .properties()
      .find((property) => property.propertyDefinitionId === id);
  const ownValue = (property: Property) =>
    props.source
      .properties()
      .find(
        (current) =>
          current.propertyDefinitionId === property.propertyDefinitionId
      ) ?? property;
  const setOption = async (property: Property, optionId: string) => {
    if (!canEditProject(props.project)) return;
    try {
      await props.commands.saveProperty(props.project.id, ownValue(property), {
        valueType: 'SELECT_STRING',
        values: [optionId],
      });
    } catch (error) {
      console.error('Failed to update project', error);
      toast.failure(`Could not update ${property.displayName.toLowerCase()}`);
    }
  };
  const renameProject = async (name: string) => {
    if (!canEditProject(props.project))
      throw new Error('Project is read-only.');
    await props.commands.rename(props.project.id, name);
  };
  const deleteProject = async () => {
    if (!canDeleteProject(props.project)) {
      setError('Only the project owner can delete it.');
      return;
    }
    const projectId = props.project.id;
    setError(undefined);
    try {
      await props.commands.delete(projectId);
      if (props.project.id === projectId) props.onDelete();
    } catch (error) {
      if (props.project.id !== projectId) return;
      setError(
        error instanceof Error ? error.message : 'Could not delete project.'
      );
    }
  };
  const optionTool = (propertyId: string, label: string): BlockTool => ({
    label,
    group: 'file',
    action: () => {},
    icon: propertyId === SYSTEM_PROPERTY_IDS.STATUS ? StatusIcon : PriorityIcon,
    condition: () =>
      canEditProject(props.project) && Boolean(definition(propertyId)),
    get children() {
      const property = definition(propertyId);
      return (property?.options ?? []).map((option) => ({
        label: formatOptionValue(option),
        action: () => {
          if (property)
            fireAndForget(setOption(property, option.id), 'projects');
        },
      }));
    },
  });
  const openTitleMenu = (event: MouseEvent) => {
    if (!isTouchDevice()) return;
    const trigger = panel.titleFileMenuTrigger();
    if (!trigger) return;
    event.preventDefault();
    event.stopPropagation();
    trigger();
  };

  const titleContent = () => (
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
  return (
    <>
      <HeaderIsland class="shrink">
        <Show
          when={isTouchDevice()}
          fallback={
            <div class="relative flex min-w-0 items-center gap-1.5">
              {titleContent()}
            </div>
          }
        >
          <button
            type="button"
            class="flex h-full min-w-0 max-w-[min(65vw,18rem)] items-center gap-1.5"
            aria-label={`${props.project.name} actions`}
            aria-haspopup="dialog"
            onClick={openTitleMenu}
          >
            {titleContent()}
            <CaretDownIcon class="size-3.5 shrink-0 text-ink-muted" />
          </button>
        </Show>
      </HeaderIsland>
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
          tools={[
            {
              label: () => t('entityActions.openInNewSplit'),
              icon: SquaresFourIcon,
              action: () =>
                openProject(layout, props.project.id, {
                  section: props.section,
                  newSplit: true,
                }),
              condition: () =>
                !isMobile() &&
                (globalSplitManager()?.canAppendSplit() ?? false),
            },
            {
              label: () => t('entityActions.rename'),
              icon: RenameIcon,
              group: 'file',
              action: () => setRenaming(true),
              condition: () => canEditProject(props.project),
            },
            optionTool(
              SYSTEM_PROPERTY_IDS.STATUS,
              t('entityActions.setStatus')
            ),
            optionTool(
              SYSTEM_PROPERTY_IDS.PRIORITY,
              t('entityActions.setPriority')
            ),
            {
              label: () => t('entityActions.share'),
              icon: ShareIcon,
              group: 'sharing',
              action: props.onShare,
            },
            {
              label: () => t('entityActions.delete'),
              icon: TrashIcon,
              group: 'delete',
              action: () => {
                setError(undefined);
                setDeleting(true);
              },
              condition: () => canDeleteProject(props.project),
            },
          ]}
        />
      </SplitTitleFileMenu>
      <Show when={renaming()}>
        <RenameProjectDialog
          name={props.project.name}
          onOpenChange={setRenaming}
          onRename={renameProject}
        />
      </Show>
      <Show when={deleting()}>
        <DeleteProjectsDialog
          count={1}
          pending={props.commands.pending()}
          error={error()}
          onOpenChange={setDeleting}
          onDelete={() => fireAndForget(deleteProject(), 'projects')}
        />
      </Show>
    </>
  );
}
