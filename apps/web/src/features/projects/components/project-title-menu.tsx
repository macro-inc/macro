import { t } from '@app/lib/i18n';
import { globalSplitManager } from '@app/signal/splitLayout';
import type { BlockTool } from '@components/app/block-tool';
import { useSplitLayout } from '@components/app/split-layout/layout';
import { toast } from '@core/component/Toast/Toast';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { fireAndForget } from '@core/util/fireAndForget';
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
import { MobileProjectTitleMenu } from '../views/mobile/project-title-menu';
import { ProjectTitleMenuView } from '../views/project-title-menu';
import { DeleteProjectsDialog } from './delete-projects-dialog';
import { RenameProjectDialog } from './rename-project-dialog';

type ProjectTitleMenuProps = {
  project: ProjectDetail;
  source: ProjectSource;
  commands: ReturnType<ProjectsContext['createCommands']>;
  section: ProjectSection;
  onShare(): void;
  onDelete(): void;
};

export type ProjectTitleMenuActions = Record<
  'openInNewSplit' | 'rename' | 'status' | 'priority' | 'share' | 'remove',
  BlockTool
>;

export type ProjectTitleMenuViewProps = {
  project: ProjectDetail;
  actions: ProjectTitleMenuActions;
};

export function ProjectTitleMenu(props: ProjectTitleMenuProps) {
  const definitions = useProjectsContext().createPropertyDefinitionsSource();
  const layout = useSplitLayout();
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
  const actions: ProjectTitleMenuActions = {
    openInNewSplit: {
      label: () => t('entityActions.openInNewSplit'),
      icon: SquaresFourIcon,
      action: () =>
        openProject(layout, props.project.id, {
          section: props.section,
          newSplit: true,
        }),
      condition: () => globalSplitManager()?.canAppendSplit() ?? false,
    },
    rename: {
      label: () => t('entityActions.rename'),
      icon: RenameIcon,
      group: 'file',
      action: () => setRenaming(true),
      condition: () => canEditProject(props.project),
    },
    status: optionTool(
      SYSTEM_PROPERTY_IDS.STATUS,
      t('entityActions.setStatus')
    ),
    priority: optionTool(
      SYSTEM_PROPERTY_IDS.PRIORITY,
      t('entityActions.setPriority')
    ),
    share: {
      label: () => t('entityActions.share'),
      icon: ShareIcon,
      group: 'sharing',
      action: props.onShare,
    },
    remove: {
      label: () => t('entityActions.delete'),
      icon: TrashIcon,
      group: 'delete',
      action: () => {
        setError(undefined);
        setDeleting(true);
      },
      condition: () => canDeleteProject(props.project),
    },
  };
  return (
    <>
      <Show
        when={isTouchDevice()}
        fallback={
          <ProjectTitleMenuView project={props.project} actions={actions} />
        }
      >
        <MobileProjectTitleMenu project={props.project} actions={actions} />
      </Show>
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
