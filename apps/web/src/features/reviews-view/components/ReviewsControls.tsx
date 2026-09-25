import {
  type ListControlOption,
  ListFilterDropdown,
  type ListFilterGroup,
  ListSortDropdown,
  MobileFilterDrawer,
  useViewControlHotkeys,
} from '@app/components/view-shell';
import { MobileDrawer } from '@components/app/mobile/MobileDrawer';
import { useSplitPanelOrThrow } from '@components/app/split-layout/layoutUtils';
import { Accordion } from '@kobalte/core/accordion';
import { createSignal, For, Show } from 'solid-js';
import type { ReviewsSortId } from '../reviews-types';

export type ReviewsFilterId = 'repository' | 'author';

export type ReviewsControlProps = {
  sort: ReviewsSortId;
  onSortChange: (sort: ReviewsSortId) => void;
  repositories: ListControlOption<string>[];
  authors: ListControlOption<string>[];
  selectedRepositories: readonly string[];
  selectedAuthors: readonly string[];
  onFilterChange: (
    group: ReviewsFilterId,
    id: string,
    selected: boolean
  ) => void;
  onClearFilters: () => void;
};

const SORT_OPTIONS: ListControlOption<ReviewsSortId>[] = [
  { id: 'updated_at', label: 'Updated' },
  { id: 'created_at', label: 'Created' },
];

function filterGroups(
  props: ReviewsControlProps
): ListFilterGroup<ReviewsFilterId, string>[] {
  return [
    {
      id: 'repository',
      label: 'Repository',
      options: props.repositories,
      searchPlaceholder: 'Search repositories',
    },
    {
      id: 'author',
      label: 'Author',
      options: props.authors,
      searchPlaceholder: 'Search authors',
    },
  ];
}

function isSelected(
  props: ReviewsControlProps,
  group: ReviewsFilterId,
  id: string
) {
  return (
    group === 'repository' ? props.selectedRepositories : props.selectedAuthors
  ).includes(id);
}

export function ReviewsControls(props: ReviewsControlProps) {
  const panel = useSplitPanelOrThrow();
  const [openMenu, setOpenMenu] = createSignal<'filters' | 'sort'>();
  let filterTrigger: HTMLButtonElement | undefined;
  let sortTrigger: HTMLButtonElement | undefined;

  const handleMenuOpenChange =
    (menu: 'filters' | 'sort') => (open: boolean) => {
      setOpenMenu((current) =>
        open ? menu : current === menu ? undefined : current
      );
    };

  useViewControlHotkeys({
    scopeId: panel.splitHotkeyScope,
    enabled: panel.isPanelActive,
    filter: {
      description: 'Filter pull requests',
      run: () => {
        if (!filterTrigger) return false;
        setOpenMenu('filters');
        return true;
      },
    },
    sort: {
      description: 'Sort pull requests',
      run: () => {
        if (!sortTrigger) return false;
        setOpenMenu('sort');
        return true;
      },
    },
  });

  const activeCount = () =>
    props.selectedRepositories.length + props.selectedAuthors.length;

  return (
    <div class="flex min-w-0 shrink-0 items-center justify-end gap-2 @max-[720px]/view-shell:gap-1">
      <ListSortDropdown
        label="Sort pull requests"
        value={props.sort}
        options={SORT_OPTIONS}
        open={openMenu() === 'sort'}
        onChange={props.onSortChange}
        onOpenChange={handleMenuOpenChange('sort')}
        triggerRef={(element) => (sortTrigger = element)}
      />
      <div class="relative shrink-0">
        <ListFilterDropdown
          label="Filter pull requests"
          groups={filterGroups(props)}
          open={openMenu() === 'filters'}
          onOpenChange={handleMenuOpenChange('filters')}
          triggerRef={(element) => (filterTrigger = element)}
          isSelected={(group, id) => isSelected(props, group, id)}
          onSelectionChange={props.onFilterChange}
          onClear={props.onClearFilters}
        />
        <Show when={activeCount() > 0}>
          <span class="pointer-events-none absolute -top-0.5 right-0 z-10 flex size-4 translate-x-1/2 items-center justify-center rounded-full bg-accent text-xxs font-medium leading-none text-surface">
            {activeCount()}
          </span>
        </Show>
      </div>
    </div>
  );
}

export function ReviewsFilterDrawer(props: ReviewsControlProps) {
  const groups = () => filterGroups(props);
  const activeCount = () =>
    props.selectedRepositories.length + props.selectedAuthors.length;

  return (
    <MobileFilterDrawer
      triggerLabel="Open pull request filters"
      label="Pull request list controls"
      activeCount={activeCount()}
      onClear={props.onClearFilters}
    >
      <MobileDrawer.Label id="reviews-sort-label" class="pt-4">
        Sort
      </MobileDrawer.Label>
      <MobileDrawer.Section
        role="radiogroup"
        aria-labelledby="reviews-sort-label"
      >
        <For each={SORT_OPTIONS}>
          {(option) => (
            <MobileFilterDrawer.Option
              selectionMode="single"
              checked={props.sort === option.id}
              onChange={() => props.onSortChange(option.id)}
            >
              {option.label}
            </MobileFilterDrawer.Option>
          )}
        </For>
      </MobileDrawer.Section>
      <MobileDrawer.Label class="pt-4">Filters</MobileDrawer.Label>
      <Accordion multiple collapsible defaultValue={['repository']}>
        <div class="flex flex-col gap-3">
          <For each={groups()}>
            {(group) => (
              <MobileFilterDrawer.Section
                value={group.id}
                label={group.label}
                activeCount={
                  group.options.filter((option) =>
                    isSelected(props, group.id, option.id)
                  ).length
                }
              >
                <For each={group.options}>
                  {(option) => (
                    <MobileFilterDrawer.Option
                      checked={isSelected(props, group.id, option.id)}
                      onChange={(selected) =>
                        props.onFilterChange(group.id, option.id, selected)
                      }
                    >
                      {option.label}
                    </MobileFilterDrawer.Option>
                  )}
                </For>
              </MobileFilterDrawer.Section>
            )}
          </For>
        </div>
      </Accordion>
    </MobileFilterDrawer>
  );
}
