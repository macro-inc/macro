import { useCalendarPreferences } from '@app/features/calendar/utils/preferences';
import { t } from '@app/lib/i18n';
import { UserIcon } from '@core/component/UserIcon';
import { isMobile } from '@core/mobile/isMobile';
import { getDisplayName } from '@core/user/displayName';
import { tryMacroId } from '@core/user/macroId';
import { TaskPropertyControl } from '@entity/extractors-property/task-property-control';
import { downloadFile } from '@filesystem/download';
import { PropertyEntitySelector } from '@property/editors/selectors/PropertyEntitySelector';
import { queryReadyGate } from '@queries/gate';
import { useDocumentAccessLevelQuery } from '@queries/storage/document-metadata';
import { mapGraphqlProperties } from '@service-storage/graphql-soup';
import { cn } from '@ui/utils/classname';
import { type Accessor, createMemo, type JSX, Suspense } from 'solid-js';
import type { ReportTask, TaskLabelParts } from './components/time-key-label';
import { createLocalToday } from './primitives/create-local-today';
import type { ProjectTimeClock } from './primitives/create-project-time';
import { TaskTimerCount } from './task-timer-count';
import type { PickedTask } from './views/shared/tasks-time-props';

/** A person in a report row: avatar and name, with no card of their own. */
export function ReportPerson(props: { userId: string }): JSX.Element {
  const name = () => getDisplayName(tryMacroId(props.userId));
  return (
    <span class="flex min-w-0 items-center gap-2">
      <UserIcon
        id={props.userId}
        name={name()}
        size="sm"
        suppressClick
        showTooltip={false}
      />
      <span class="truncate">{name()}</span>
    </span>
  );
}

function canEditTask(task: ReportTask): boolean {
  const permission = task.viewerPermission;
  return (
    permission?.__typename === 'GraphqlAccessLevelPermission' &&
    (permission.accessLevel === 'EDIT' || permission.accessLevel === 'OWNER')
  );
}

/**
 * A task's priority then status, by the Tasks list row's own controls and
 * spacing: a phone's narrow row on phones, the list row elsewhere. A viewer
 * who can only view the task sees them without being offered a change.
 */
function ReportTaskLead(props: { task: ReportTask }): JSX.Element {
  const entity = createMemo(() => ({
    id: props.task.id,
    properties: mapGraphqlProperties(props.task.properties),
    subType: {
      type: 'task' as const,
      is_completed:
        props.task.subType?.__typename === 'GraphqlTaskSubType'
          ? props.task.subType.isCompleted
          : undefined,
    },
  }));
  const canEdit = () => canEditTask(props.task);
  return (
    <span
      class={cn('flex shrink-0 items-center', isMobile() ? 'gap-1' : 'gap-2')}
    >
      <TaskPropertyControl
        entity={entity()}
        property="priority"
        canEdit={canEdit()}
      />
      <span
        class={cn(
          'flex shrink-0 items-center',
          isMobile() ? '-ml-1 -mr-2' : '-mr-1 touch:-mr-2'
        )}
      >
        <TaskPropertyControl
          entity={entity()}
          property="status"
          canEdit={canEdit()}
        />
      </span>
    </span>
  );
}

function ReportTaskTimer(props: { taskId: string }): JSX.Element {
  return <TaskTimerCount taskId={props.taskId} compact={isMobile()} />;
}

/** A task in a report reads as its row in the Tasks list. */
export const REPORT_TASK_PARTS: TaskLabelParts = {
  Lead: ReportTaskLead,
  Timer: ReportTaskTimer,
};

/** Days are this device's; weeks start as the calendar's preference says. */
export function useReportClock(): ProjectTimeClock {
  const [preferences] = useCalendarPreferences();
  return {
    today: createLocalToday(),
    weekStartsOn: () => preferences.weekStartsOn,
  };
}

/** The calendar's Show weekends preference. */
export function useShowWeekends(): () => boolean {
  const [preferences] = useCalendarPreferences();
  return () => preferences.showWeekends;
}

export function saveCsv(content: string, filename: string) {
  return downloadFile(
    new Blob([content], { type: 'text/csv;charset=utf-8' }),
    filename
  );
}

/** The app's task search, picking one task. */
export function TaskSearch(props: {
  onPick(task: PickedTask): void;
  onClose(): void;
  presentation?: 'sheet';
}): JSX.Element {
  return (
    <Suspense
      fallback={
        <p role="status" class="p-3 text-sm text-ink-muted">
          {t('viewMenus.loadingTasks')}
        </p>
      }
    >
      <PropertyEntitySelector
        presentation={props.presentation}
        config={{
          specificEntityType: 'TASK',
          isMultiSelect: false,
          placeholder: t('viewMenus.searchTasks'),
          fillHeight: props.presentation === 'sheet',
        }}
        selectedOptions={() => new Set<string>()}
        setSelectedOptions={(_ids, picked) => {
          const task = picked?.[0];
          if (task) props.onPick({ id: task.id, name: task.name });
        }}
        onClose={props.onClose}
        onCancel={props.onClose}
      />
    </Suspense>
  );
}

/** Whether the viewer has edit access to a task, which logging time needs. */
export function TaskEditAccess(props: {
  taskId: string;
  children: (canEdit: Accessor<boolean | undefined>) => JSX.Element;
}): JSX.Element {
  const access = useDocumentAccessLevelQuery(() => props.taskId);
  const canEdit = () => {
    if (!queryReadyGate(access)) return undefined;
    return access.data === 'edit' || access.data === 'owner';
  };
  return <>{props.children(canEdit)}</>;
}
