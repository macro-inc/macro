import {
  type ListControlOption,
  ListFilterDropdown,
  type ListFilterGroup,
  ListSortDropdown,
  MobileFilterDrawer,
  useViewControlHotkeys,
} from '@app/components/view-shell';
import { PrOriginIcon, PrPriorityIcon } from '@block-pr/component/PrLinks';
import {
  PR_PRIORITY_IDS,
  PR_PRIORITY_LABELS,
  type PrLinkKind,
} from '@block-pr/data/pr-links';
import { PR_ORIGIN_LABELS, PR_ORIGIN_TOOLS } from '@block-pr/data/pr-origin';
import { MobileDrawer } from '@components/app/mobile/MobileDrawer';
import { useSplitPanelOrThrow } from '@components/app/split-layout/layoutUtils';
import { Accordion } from '@kobalte/core/accordion';
import { createSignal, For, Show } from 'solid-js';
import { UNKNOWN_ORIGIN } from '../reviews-filter';
import type {
  ReviewsFilterId,
  ReviewsFilterSelection,
  ReviewsReviewFilterId,
  ReviewsSortId,
  ReviewsStatusFilterId,
} from '../reviews-types';

export type ReviewsControlProps = {
  sort: ReviewsSortId;
  onSortChange: (sort: ReviewsSortId) => void;
  repositories: ListControlOption<string>[];
  authors: ListControlOption<string>[];
  assignees: ListControlOption<string>[];
  labels: ListControlOption<string>[];
  /** Offers the review filters that match the viewer's GitHub user id. */
  hasGithubIdentity: boolean;
  selected: ReviewsFilterSelection;
  onFilterChange: (
    group: ReviewsFilterId,
    id: string,
    selected: boolean
  ) => void;
  onClearFilters: () => void;
};

const SORT_OPTIONS: ListControlOption<ReviewsSortId>[] = [
  { id: 'priority', label: 'Priority' },
  { id: 'recently_updated', label: 'Recently updated' },
  { id: 'least_recently_updated', label: 'Least recently updated' },
  { id: 'newest', label: 'Newest' },
  { id: 'oldest', label: 'Oldest' },
];

const STATUS_OPTIONS: ListControlOption<ReviewsStatusFilterId>[] = [
  { id: 'open', label: 'Open' },
  { id: 'closed', label: 'Closed' },
  { id: 'merged', label: 'Merged' },
];

const REVIEW_OPTIONS: ListControlOption<ReviewsReviewFilterId>[] = [
  { id: 'reviewed_by_me', label: 'Reviewed by you' },
  { id: 'not_reviewed_by_me', label: 'Not reviewed by you' },
  { id: 'awaiting_my_review', label: 'Awaiting review from you' },
];

const PRIORITY_OPTIONS: ListControlOption<string>[] = PR_PRIORITY_IDS.map(
  (id) => ({
    id,
    label: PR_PRIORITY_LABELS[id],
    icon: () => <PrPriorityIcon priority={id} />,
  })
);

const ORIGIN_OPTIONS: ListControlOption<string>[] = [
  ...PR_ORIGIN_TOOLS.map((tool) => ({
    id: tool,
    label: PR_ORIGIN_LABELS[tool],
    icon: () => <PrOriginIcon tool={tool} class="size-4" />,
  })),
  { id: UNKNOWN_ORIGIN, label: 'Unknown' },
];

const LINKED_OPTIONS: ListControlOption<string>[] = [
  { id: 'agent', label: 'An agent session' },
  { id: 'ticket', label: 'A ticket' },
  { id: 'customer', label: 'A customer' },
  { id: 'channel', label: 'A channel' },
] satisfies ListControlOption<PrLinkKind>[];

function filterGroups(
  props: ReviewsControlProps
): ListFilterGroup<ReviewsFilterId, string>[] {
  return [
    { id: 'status', label: 'Status', options: STATUS_OPTIONS },
    { id: 'priority', label: 'Priority', options: PRIORITY_OPTIONS },
    { id: 'linked', label: 'Linked to', options: LINKED_OPTIONS },
    { id: 'origin', label: 'Started from', options: ORIGIN_OPTIONS },
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
    {
      id: 'assignee',
      label: 'Assignee',
      options: props.assignees,
      searchPlaceholder: 'Search assignees',
    },
    {
      id: 'label',
      label: 'Label',
      options: props.labels,
      searchPlaceholder: 'Search labels',
    },
    ...(props.hasGithubIdentity
      ? [{ id: 'review' as const, label: 'Reviews', options: REVIEW_OPTIONS }]
      : []),
  ];
}

function isSelected(
  props: ReviewsControlProps,
  group: ReviewsFilterId,
  id: string
) {
  return props.selected[group].includes(id);
}

export const activeReviewsFilterCount = (selected: ReviewsFilterSelection) =>
  Object.values(selected).reduce((count, ids) => count + ids.length, 0);

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

  const activeCount = () => activeReviewsFilterCount(props.selected);

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
  const activeCount = () => activeReviewsFilterCount(props.selected);

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
      <Accordion multiple collapsible defaultValue={['priority']}>
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
                      {option.content?.() ?? option.label}
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
