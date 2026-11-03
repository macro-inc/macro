import { openCommandMenuCategory } from '@app/features/command/open-command-menu-category';
import { LINEAR } from '@app/features/hotkey-profiles/core/profiles';
import { useHotkeyProfile } from '@app/features/hotkey-profiles/primitives/use-hotkey-profile';
import { useAllProperties } from '@app/features/property/editor/hooks/useAllProperties';
import { useSavePropertyForMultiEntitites } from '@app/features/property/editor/hooks/useSaveProperties';
import {
  openPropertyEditor,
  type PropertyEditorEntity,
} from '@app/features/property/editor/state/propertyEditor';
import { t } from '@app/lib/i18n';
import { useSplitLayout } from '@components/app/split-layout/layout';
import { toast } from '@core/component/Toast/Toast';
import { useSettingsState } from '@core/constant/SettingsState';
import { useUserId } from '@core/context/user';
import { fireAndForget } from '@core/util/fireAndForget';
import { PROPERTY_OPTION_IDS, SYSTEM_PROPERTY_IDS } from '@property/constants';
import type { PropertyApiValues } from '@property/types';
import {
  fetchEntityProperties,
  useBulkSaveEntityPropertiesMutation,
} from '@queries/properties/entity';
import { EntityType } from '@service-properties/generated/schemas/entityType';
import { ResultAsync } from 'neverthrow';
import { openSubtaskComposer } from './open-subtask-composer';
import { useTasksView } from './tasks-view-context';

/** ⌘⌥1–5, in Linear's order. */
const STATUS_BY_NUMBER = [
  PROPERTY_OPTION_IDS.STATUS.NOT_STARTED,
  PROPERTY_OPTION_IDS.STATUS.IN_PROGRESS,
  PROPERTY_OPTION_IDS.STATUS.IN_REVIEW,
  PROPERTY_OPTION_IDS.STATUS.COMPLETED,
  PROPERTY_OPTION_IDS.STATUS.CANCELED,
];

export type UseLinearHotkeysOptions = {
  scopeId: string;
  enabled: () => boolean;
};

/** Linear's keys across the Tasks view, for people who turned them on. */
export function useLinearHotkeys(options: UseLinearHotkeysOptions) {
  const {
    state,
    setState,
    setTab,
    setFacets,
    selectedTask,
    openTask,
    closeTask,
    list,
    source,
    projectsEnabled,
  } = useTasksView();
  const layout = useSplitLayout();
  const { openSettings } = useSettingsState();
  const userId = useUserId();
  const allProperties = useAllProperties();
  const saveProperties = useSavePropertyForMultiEntitites();
  const bulkSave = useBulkSaveEntityPropertiesMutation();
  const property = (id: string) =>
    allProperties().find((definition) => definition.id === id);

  // The open task, else the selected tasks, else the task under the cursor.
  const targets = (): PropertyEditorEntity[] => {
    const open = selectedTask();
    if (open) {
      const row = source
        .items()
        .find((item) => item.kind === 'entity' && item.entity.id === open.id);
      return [
        row?.kind === 'entity'
          ? row.entity
          : {
              id: open.id,
              name: open.fallbackName ?? '',
              entityType: EntityType.TASK,
            },
      ];
    }
    const selected = list.selection
      .items()
      .flatMap((row) => (row.kind === 'entity' ? [row.entity] : []));
    if (selected.length > 0) return selected;
    const row = list.focus.result()?.item;
    return row?.kind === 'entity' ? [row.entity] : [];
  };

  const save = (propertyId: string, value: PropertyApiValues) => {
    const entities = targets();
    const definition = property(propertyId);
    if (entities.length === 0 || !definition) return false;
    fireAndForget(
      (async () => {
        if (!(await saveProperties(entities, definition, value))) {
          toast.failure(t('hotkeyProfiles.taskUpdateFailed'));
        }
      })(),
      'linear-hotkeys'
    );
    return true;
  };

  const editProperty = (propertyId: string) => {
    const entities = targets();
    const definition = property(propertyId);
    if (entities.length === 0 || !definition) return false;
    openPropertyEditor(entities, 'direct', definition);
    return true;
  };

  // Adds the viewer to each task's assignees, keeping the others.
  const assignToMe = async (entities: PropertyEditorEntity[], me: string) => {
    const definition = property(SYSTEM_PROPERTY_IDS.ASSIGNEES);
    if (!definition) return;
    const current = await ResultAsync.fromPromise(
      Promise.all(
        entities.map((entity) => fetchEntityProperties('TASK', entity.id))
      ),
      () => 'fetch-failed' as const
    );
    if (current.isErr()) {
      toast.failure(t('hotkeyProfiles.taskUpdateFailed'));
      return;
    }
    const updates = entities.flatMap((entity, index) => {
      const assignees = current.value[index]?.find(
        (value) => value.propertyDefinitionId === SYSTEM_PROPERTY_IDS.ASSIGNEES
      );
      const refs =
        assignees?.valueType === 'ENTITY' ? (assignees.value ?? []) : [];
      if (refs.some((ref) => ref.entity_id === me)) return [];
      return [
        {
          entityId: entity.id,
          entityType: EntityType.TASK,
          property: definition,
          apiValues: {
            valueType: 'ENTITY' as const,
            refs: [...refs, { entity_id: me, entity_type: EntityType.USER }],
          },
        },
      ];
    });
    if (updates.length === 0) return;
    const saved = await ResultAsync.fromPromise(
      bulkSave.mutateAsync({ properties: updates }),
      () => 'save-failed' as const
    );
    if (saved.isErr()) toast.failure(t('hotkeyProfiles.taskUpdateFailed'));
  };

  // Opens the open task's parent or first sub-task.
  const openRelatedTask = async (taskId: string, propertyId: string) => {
    const properties = await ResultAsync.fromPromise(
      fetchEntityProperties('TASK', taskId),
      () => 'fetch-failed' as const
    );
    if (properties.isErr()) {
      toast.failure(t('hotkeyProfiles.taskOpenFailed'));
      return;
    }
    // The person may have moved on while the task's properties loaded.
    if (selectedTask()?.id !== taskId) return;
    const related = properties.value.find(
      (value) => value.propertyDefinitionId === propertyId
    );
    const ref =
      related?.valueType === 'ENTITY' ? related.value?.[0] : undefined;
    if (ref) openTask({ id: ref.entity_id });
  };

  const openRelated = (propertyId: string) => {
    const open = selectedTask();
    if (!open) return false;
    fireAndForget(openRelatedTask(open.id, propertyId), 'linear-hotkeys');
    return true;
  };

  const showTab = (
    tab: Parameters<typeof setTab>[0],
    facets?: Parameters<typeof setFacets>[0]
  ) => {
    setTab(tab);
    // setTab keeps the facets of a tab that's already showing.
    if (facets) setFacets(facets);
    return true;
  };

  useHotkeyProfile(LINEAR, {
    scopeId: options.scopeId,
    enabled: options.enabled,
    actions: {
      closeTask: () => {
        if (!selectedTask()) return false;
        closeTask();
        return true;
      },
      openTaskMenu: () => {
        openCommandMenuCategory('tasks');
        return true;
      },
      openProjectMenu: () => {
        if (!projectsEnabled()) return false;
        openCommandMenuCategory('projects');
        return true;
      },
      openPersonMenu: () => {
        openCommandMenuCategory('dms');
        return true;
      },
      openParentTask: () => openRelated(SYSTEM_PROPERTY_IDS.PARENT_TASK),
      openSubtask: () => openRelated(SYSTEM_PROPERTY_IDS.SUBTASKS),
      toggleBoard: () => {
        setState('layout', state.layout === 'board' ? 'list' : 'board');
        return true;
      },
      showMyTasks: () => showTab('my-tasks'),
      showBacklog: () => showTab('my-tasks', { status: ['not-started'] }),
      showClosed: () =>
        showTab('team-tasks', { status: ['completed', 'canceled'] }),
      showAllTasks: () => showTab('team-tasks'),
      showBoard: () => {
        setState('layout', 'board');
        return true;
      },
      showProjects: () => projectsEnabled() && showTab('projects'),
      openSettings: () => {
        openSettings();
        return true;
      },
      setStatus: (index) => {
        const status = STATUS_BY_NUMBER[index];
        if (!status) return false;
        return save(SYSTEM_PROPERTY_IDS.STATUS, {
          valueType: 'SELECT_STRING',
          values: [status],
        });
      },
      createTask: () => {
        layout.popoverSplit({ type: 'component', id: 'task-compose' });
        return true;
      },
      assignToMe: () => {
        const entities = targets();
        const me = userId();
        if (entities.length === 0 || !me) return false;
        fireAndForget(assignToMe(entities, me), 'linear-hotkeys');
        return true;
      },
      setStoryPoints: () => editProperty(SYSTEM_PROPERTY_IDS.STORY_POINTS),
      setDueDate: () => editProperty(SYSTEM_PROPERTY_IDS.DUE_DATE),
      clearDueDate: () =>
        save(SYSTEM_PROPERTY_IDS.DUE_DATE, { valueType: 'DATE', value: null }),
      setDependsOn: () => editProperty(SYSTEM_PROPERTY_IDS.DEPENDS_ON),
      clearFilters: () => {
        setFacets({});
        return true;
      },
      createSubtask: () => {
        const [parent, ...others] = targets();
        if (!parent || others.length > 0) return false;
        openSubtaskComposer(layout, parent.id);
        return true;
      },
    },
  });
}
