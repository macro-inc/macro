import type { ListFilterGroup } from '@app/components/view-shell/ListDropdowns';
import { MobileFilterDrawer } from '@app/components/view-shell/MobileFilterDrawer';
import { t } from '@app/lib/i18n';
import { MobileDrawer } from '@components/app/mobile/MobileDrawer';
import { Input } from '@ui';
import { createSignal, createUniqueId, For } from 'solid-js';
import type { createProjectCollection } from '../primitives/project-collection';

export type ProjectFilterGroup = 'status' | 'priority' | 'assignee';
export const PROJECT_SORT_OPTIONS = [
  {
    id: 'updated',
    get label() {
      return t('viewMenus.updated');
    },
  },
  {
    id: 'created',
    get label() {
      return t('viewMenus.created');
    },
  },
] as const;
export const PROJECT_GROUP_OPTIONS = [
  {
    id: 'none',
    get label() {
      return t('viewMenus.groupNone');
    },
  },
  {
    id: 'status',
    get label() {
      return t('viewMenus.status');
    },
  },
  {
    id: 'priority',
    get label() {
      return t('viewMenus.priority');
    },
  },
  {
    id: 'assignee',
    get label() {
      return t('viewMenus.assignee');
    },
  },
] as const;

export function ProjectsFilterDrawer(props: {
  collection: ReturnType<typeof createProjectCollection>;
  groups: ListFilterGroup<ProjectFilterGroup, string>[];
  activeCount: number;
  isSelected: (group: ProjectFilterGroup, id: string) => boolean;
  onSelectionChange: (
    group: ProjectFilterGroup,
    id: string,
    selected: boolean
  ) => void;
  onClear: () => void;
}) {
  const [open, setOpen] = createSignal(false);
  const prefix = createUniqueId();
  return (
    <MobileFilterDrawer
      open={open()}
      onOpenChange={setOpen}
      triggerLabel={t('viewMenus.openProjectFilters')}
      label={t('viewMenus.projectListControls')}
      activeCount={props.activeCount}
      onClear={props.onClear}
    >
      <MobileDrawer.Label id={`${prefix}-sort`} class="pt-4">
        {t('viewMenus.sort')}
      </MobileDrawer.Label>
      <MobileDrawer.Section
        role="radiogroup"
        aria-labelledby={`${prefix}-sort`}
      >
        <For each={PROJECT_SORT_OPTIONS}>
          {(option) => (
            <MobileFilterDrawer.Option
              selectionMode="single"
              checked={props.collection.sort() === option.id}
              onChange={() => props.collection.setSort(option.id)}
            >
              {option.label}
            </MobileFilterDrawer.Option>
          )}
        </For>
      </MobileDrawer.Section>
      <MobileDrawer.Label id={`${prefix}-group`} class="pt-4">
        {t('viewMenus.group')}
      </MobileDrawer.Label>
      <MobileDrawer.Section
        role="radiogroup"
        aria-labelledby={`${prefix}-group`}
      >
        <For each={PROJECT_GROUP_OPTIONS}>
          {(option) => (
            <MobileFilterDrawer.Option
              selectionMode="single"
              checked={props.collection.groupBy() === option.id}
              onChange={() => props.collection.setGroupBy(option.id)}
            >
              {option.label}
            </MobileFilterDrawer.Option>
          )}
        </For>
      </MobileDrawer.Section>
      <For each={props.groups}>
        {(group) => (
          <>
            <MobileDrawer.Label id={`${prefix}-${group.id}`} class="pt-4">
              {group.label}
            </MobileDrawer.Label>
            <MobileDrawer.Section
              role="radiogroup"
              aria-labelledby={`${prefix}-${group.id}`}
            >
              <For each={group.options}>
                {(option) => (
                  <MobileFilterDrawer.Option
                    selectionMode="single"
                    checked={props.isSelected(group.id, option.id)}
                    onChange={() =>
                      props.onSelectionChange(
                        group.id,
                        option.id,
                        !props.isSelected(group.id, option.id)
                      )
                    }
                  >
                    {option.label}
                  </MobileFilterDrawer.Option>
                )}
              </For>
            </MobileDrawer.Section>
          </>
        )}
      </For>
      <MobileDrawer.Label class="pt-4">
        {t('viewMenus.dueDate')}
      </MobileDrawer.Label>
      <div class="grid grid-cols-2 gap-3 px-3 pb-4">
        <label class="flex min-w-0 flex-col gap-1 text-sm">
          {t('viewMenus.from')}
          <Input
            type="date"
            value={props.collection.dueAfter()}
            onInput={(event) =>
              props.collection.setDueAfter(event.currentTarget.value)
            }
          />
        </label>
        <label class="flex min-w-0 flex-col gap-1 text-sm">
          {t('viewMenus.through')}
          <Input
            type="date"
            value={props.collection.dueBefore()}
            onInput={(event) =>
              props.collection.setDueBefore(event.currentTarget.value)
            }
          />
        </label>
      </div>
    </MobileFilterDrawer>
  );
}
