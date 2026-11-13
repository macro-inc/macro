import { ListColumnHeader } from '@app/components/list/ListColumnHeader';
import '@app/features/tasks-view/components/task-list/task-list.css';
import { isMobile } from '@core/mobile/isMobile';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import CalendarIcon from '@icon/system/regular/calendar.svg';
import PriorityIcon from '@icon/system/regular/chart-bar.svg';
import StatusIcon from '@icon/system/regular/circle-dashed.svg';
import ClockIcon from '@icon/system/regular/clock.svg';
import UsersIcon from '@icon/system/regular/users.svg';
import { Modals } from '@property/component/modal';
import { PropertiesProvider } from '@property/context/PropertiesContext';
import type { Property, PropertyApiValues } from '@property/types';
import { cn } from '@ui';
import { Show, Suspense } from 'solid-js';
import type { ProjectRow as ProjectRowData } from './context/projects-context';
import { canEditProject } from './core/project';
import { MobileProjectRow } from './views/mobile/project-row';
import { DesktopProjectRow } from './views/project-row';
import { GRID_STYLE } from './views/shared/project-row-content';

export { PROJECT_GRID_COLUMNS } from './views/shared/project-row-content';
export function ProjectListHeader(props: {
  onSortUpdated?: () => void;
  updatedSelected?: boolean;
  onTimestampWidthChange?: (width: number) => void;
}) {
  return (
    <div
      role="row"
      class="task-grid-row task-grid-icon-creator project-grid-row grid h-10 w-full shrink-0 items-center gap-2 px-3 text-xs font-medium text-ink-extra-muted"
      style={GRID_STYLE}
    >
      <span role="columnheader" style={{ 'grid-area': 'indicator' }} />
      <span
        role="columnheader"
        class="ms-2 truncate"
        style={{ 'grid-area': 'content' }}
      >
        Project
      </span>
      <ListColumnHeader
        label="Status"
        area="status"
        narrowIcon={<StatusIcon class="size-4" />}
      />
      <ListColumnHeader
        label="Priority"
        area="priority"
        narrowIcon={<PriorityIcon class="size-4" />}
      />
      <ListColumnHeader
        label="Assignees"
        area="assignees"
        narrowIcon={<UsersIcon class="size-4" />}
      />
      <ListColumnHeader
        label="Due date"
        area="dueDate"
        narrowIcon={<CalendarIcon class="size-4" />}
      />
      <ListColumnHeader
        label="Updated"
        area="timestamp"
        class="task-updated-cell @max-[840px]/u-list:justify-center"
        align="end"
        narrowIcon={<ClockIcon class="size-4" />}
        onClick={props.onSortUpdated}
        active={props.updatedSelected}
        onWidthChange={props.onTimestampWidthChange}
      />
    </div>
  );
}

export type ProjectRowProps = {
  rowId: string;
  row: ProjectRowData;
  definitions?: readonly Property[];
  highlighted: boolean;
  checked: boolean;
  onFocus(): void;
  onOpen(event: MouseEvent): void;
  onChecked(selected: boolean, shiftKey: boolean): void;
  onSave(property: Property, value: PropertyApiValues): Promise<void>;
};

/** Projects share task controls and responsive tracks without pretending to be tasks. */
export function ProjectRow(props: ProjectRowProps) {
  const canEdit = () => canEditProject(props.row.project);
  const properties = () => [...props.row.properties];
  return (
    <PropertiesProvider
      entityId={props.row.project.id}
      entityType="INITIATIVE"
      canEdit={canEdit()}
      properties={properties}
      onRefresh={() => {}}
      onPropertyAdded={() => {}}
      onPropertyDeleted={() => {}}
      saveHandler={{
        saveProperty: props.onSave,
        saveDate: (property, date) =>
          props.onSave(property, { valueType: 'DATE', value: date }),
      }}
    >
      <div
        id={props.rowId}
        role="row"
        aria-selected={props.checked}
        tabIndex={-1}
        onClick={props.onOpen}
        onMouseMove={props.onFocus}
        class={cn(
          'soup-list-entity @container/entity relative flex min-h-10 w-[calc(100%-0.5rem)] flex-col rounded-xl py-0.5 mx-1 mobile:mx-0 mobile:py-0',
          {
            'bg-list-selected': props.checked,
            'bg-list-selected-highlighted':
              props.checked && props.highlighted && !isMobile(),
            'bg-list-highlighted':
              props.highlighted && !props.checked && !isMobile(),
            'not-touch:hover:bg-list-hover':
              !props.highlighted && !props.checked,
          }
        )}
      >
        <Show
          when={isTouchDevice()}
          fallback={<DesktopProjectRow {...props} />}
        >
          <MobileProjectRow {...props} />
        </Show>
      </div>
      <Suspense>
        <Modals />
      </Suspense>
    </PropertiesProvider>
  );
}
