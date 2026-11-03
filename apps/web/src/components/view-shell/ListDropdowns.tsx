import {
  FilterSubmenu,
  SearchableFilterSubmenu,
} from '@app/features/next-soup/soup-view/filters-bar/filter-menu';
import { t } from '@app/lib/i18n';
import GanttIcon from '@icon/system/regular/chart-gantt.svg';
import CheckIcon from '@icon/system/regular/check.svg';
import FilterIcon from '@icon/system/regular/funnel-simple.svg';
import BoardIcon from '@icon/system/regular/kanban.svg';
import ListIcon from '@icon/system/regular/list-bullets.svg';
import SortIcon from '@icon/system/regular/sort-ascending.svg';
import GroupIcon from '@icon/system/regular/stack.svg';
import { Key } from '@solid-primitives/keyed';
import { Button, ButtonGroup, type ButtonSize, cn, Dropdown } from '@ui';
import { batch, createSignal, For, type JSX, Show } from 'solid-js';
import { AiFilterInput, type AiFilterInputProps } from './AiFilterInput';

export type ListControlOption<TId extends string> = {
  id: TId;
  label: string;
  icon?: () => JSX.Element;
  /** Drawn in place of `label`, which still drives search. */
  content?: () => JSX.Element;
  disabled?: boolean;
};

type ListDropdownOpenProps = {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  grouped?: boolean;
};

type SingleSelectDropdownProps<TId extends string> = {
  label: string;
  icon: JSX.Element;
  value: TId;
  options: ListControlOption<TId>[];
  onChange: (value: TId) => void;
  size?: ButtonSize;
  triggerRef?: (element: HTMLButtonElement) => void;
  class?: string;
  contentClass?: string;
} & ListDropdownOpenProps;

function SingleSelectDropdown<TId extends string>(
  props: SingleSelectDropdownProps<TId>
) {
  return (
    <Dropdown
      open={props.open}
      onOpenChange={props.onOpenChange}
      placement="bottom-end"
    >
      <Dropdown.Trigger
        aria-label={props.label}
        tooltip={props.label}
        as={props.grouped ? ButtonGroup.Button : Button}
        ref={props.triggerRef}
        variant="ghost"
        size={props.size ?? (props.grouped ? 'icon-sm' : 'icon-md')}
        class={props.class}
      >
        {props.icon}
      </Dropdown.Trigger>
      <Dropdown.Content class={cn('min-w-40', props.contentClass)}>
        <Dropdown.Group>
          <Dropdown.RadioGroup
            value={props.value}
            onChange={(value) => props.onChange(value as TId)}
          >
            <For each={props.options}>
              {(option) => (
                <Dropdown.RadioItem
                  closeOnSelect
                  value={option.id}
                  disabled={option.disabled}
                >
                  <Show when={option.icon}>
                    <span
                      aria-hidden="true"
                      class="flex size-3.5 shrink-0 items-center justify-center"
                    >
                      {option.icon?.()}
                    </span>
                  </Show>
                  <span class="flex-1">
                    {option.content?.() ?? option.label}
                  </span>
                  <Dropdown.ItemIndicator>
                    <CheckIcon class="size-3.5 text-accent" />
                  </Dropdown.ItemIndicator>
                </Dropdown.RadioItem>
              )}
            </For>
          </Dropdown.RadioGroup>
        </Dropdown.Group>
      </Dropdown.Content>
    </Dropdown>
  );
}

export type ViewLayout = 'list' | 'board' | 'gantt';

export type ViewLayoutDropdownProps = Omit<
  SingleSelectDropdownProps<ViewLayout>,
  'icon' | 'label' | 'options'
> & {
  label?: string;
  layouts?: readonly ViewLayout[];
};

const VIEW_LAYOUT_OPTIONS: ListControlOption<ViewLayout>[] = [
  {
    id: 'list',
    get label() {
      return t('viewMenus.layoutList');
    },
    icon: () => <ListIcon class="size-3.5" />,
  },
  {
    id: 'board',
    get label() {
      return t('viewMenus.layoutBoard');
    },
    icon: () => <BoardIcon class="size-3.5" />,
  },
  {
    id: 'gantt',
    get label() {
      return t('viewMenus.layoutGantt');
    },
    icon: () => <GanttIcon class="size-3.5" />,
  },
];

export function ViewLayoutDropdown(props: ViewLayoutDropdownProps) {
  return (
    <SingleSelectDropdown
      {...props}
      label={props.label ?? t('viewMenus.layout')}
      options={VIEW_LAYOUT_OPTIONS.filter(
        (option) => !props.layouts || props.layouts.includes(option.id)
      )}
      icon={
        <Show
          when={props.value === 'gantt'}
          fallback={
            <Show
              when={props.value === 'board'}
              fallback={<ListIcon class="size-4" />}
            >
              <BoardIcon class="size-4" />
            </Show>
          }
        >
          <GanttIcon class="size-4" />
        </Show>
      }
    />
  );
}

export type ListSortDropdownProps<TId extends string> = Omit<
  SingleSelectDropdownProps<TId>,
  'icon' | 'label'
> & {
  label?: string;
};

export function ListSortDropdown<TId extends string>(
  props: ListSortDropdownProps<TId>
) {
  return (
    <SingleSelectDropdown
      {...props}
      label={props.label ?? t('viewMenus.sortList')}
      icon={<SortIcon class="size-4" />}
    />
  );
}

export type ListGroupDropdownProps<TId extends string> = Omit<
  SingleSelectDropdownProps<TId>,
  'icon' | 'label'
> & {
  label?: string;
};

export function ListGroupDropdown<TId extends string>(
  props: ListGroupDropdownProps<TId>
) {
  return (
    <SingleSelectDropdown
      {...props}
      label={props.label ?? t('viewMenus.groupList')}
      icon={<GroupIcon class="size-4" />}
    />
  );
}

export type ListFilterGroup<
  TGroupId extends string,
  TOptionId extends string,
> = {
  id: TGroupId;
  label: string;
  options: ListControlOption<TOptionId>[];
  selectionMode?: 'single' | 'multiple';
  defaultOptionId?: TOptionId;
  searchPlaceholder?: string;
  contentClass?: string;
};

export type ListFilterDropdownProps<
  TGroupId extends string,
  TOptionId extends string,
> = {
  groups: ListFilterGroup<TGroupId, TOptionId>[];
  isSelected: (groupId: TGroupId, optionId: TOptionId) => boolean;
  /** Include persisted selections absent from dynamic options, such as removed contacts. */
  selectedIds?: (groupId: TGroupId) => readonly TOptionId[];
  isGroupActive?: (groupId: TGroupId) => boolean;
  onSelectionChange: (
    groupId: TGroupId,
    optionId: TOptionId,
    selected: boolean
  ) => void;
  /** Replace a group's selection in one write for deferred persistence. */
  onGroupSelectionChange?: (
    groupId: TGroupId,
    ids: readonly TOptionId[]
  ) => void;
  onClear?: () => void;
  /**
   * Adds a plain-English box above the groups that resolves a description
   * into a selection. The menu closes once a fully mapped request applies.
   */
  aiFilter?: Pick<AiFilterInputProps, 'placeholder' | 'onSubmit'>;
  customTrigger?: JSX.Element;
  triggerRef?: (element: HTMLButtonElement) => void;
  label?: string;
  size?: ButtonSize;
  activeCount?: number;
  clearLabel?: string;
  class?: string;
  contentClass?: string;
  footer?: JSX.Element;
} & ListDropdownOpenProps;

/**
 * Overlays the number of applied filters on a `ListFilterDropdown` trigger, so
 * a collapsed menu still reveals that the list is filtered. Render it as a
 * sibling of the dropdown inside a `relative` wrapper.
 */
export function ListFilterCountBadge(props: { count: number }) {
  return (
    <Show when={props.count > 0}>
      <span class="pointer-events-none absolute -top-0.5 right-0 z-10 flex size-4 translate-x-1/2 items-center justify-center rounded-full bg-accent text-xxs font-medium leading-none text-surface">
        {props.count}
      </span>
    </Show>
  );
}

export function ListFilterDropdown<
  TGroupId extends string,
  TOptionId extends string,
>(props: ListFilterDropdownProps<TGroupId, TOptionId>) {
  let aiFilterInput: HTMLInputElement | undefined;
  // Uncontrolled menus track their own state so the AI box can close them.
  const [internalOpen, setInternalOpen] = createSignal(false);
  const isOpen = () => props.open ?? internalOpen();
  const setOpen = (open: boolean) => {
    props.onOpenChange?.(open);
    if (props.open === undefined) setInternalOpen(open);
  };
  const triggerSize = () => {
    if (props.size) return props.size;
    if (props.activeCount) return props.grouped ? 'sm' : 'md';
    return props.grouped ? 'icon-sm' : 'icon-md';
  };

  const isGroupActive = (group: ListFilterGroup<TGroupId, TOptionId>) =>
    props.isGroupActive?.(group.id) ??
    group.options.some(
      (option) =>
        option.id !== group.defaultOptionId &&
        props.isSelected(group.id, option.id)
    );

  const selectedOptionIds = (group: ListFilterGroup<TGroupId, TOptionId>) => [
    ...new Set([
      ...(props.selectedIds?.(group.id) ?? []),
      ...group.options
        .filter((option) => props.isSelected(group.id, option.id))
        .map((option) => option.id),
    ]),
  ];
  const setSelectedOptionIds = (
    group: ListFilterGroup<TGroupId, TOptionId>,
    ids: readonly string[]
  ) => {
    const current = selectedOptionIds(group);
    const optionIds = [
      ...new Set([...current, ...group.options.map((option) => option.id)]),
    ];
    const next = optionIds.filter((id) => {
      if (group.options.find((option) => option.id === id)?.disabled)
        return current.includes(id);
      return ids.includes(id);
    });
    if (
      next.length === current.length &&
      next.every((id) => current.includes(id))
    )
      return;
    if (props.onGroupSelectionChange) {
      props.onGroupSelectionChange(group.id, next);
      return;
    }
    batch(() => {
      for (const id of optionIds) {
        const selected = next.includes(id);
        if (selected !== current.includes(id))
          props.onSelectionChange(group.id, id, selected);
      }
    });
  };

  return (
    <Dropdown open={isOpen()} onOpenChange={setOpen} placement="bottom-end">
      <Show
        when={props.customTrigger}
        fallback={
          <Dropdown.Trigger
            aria-label={props.label ?? t('viewMenus.filterList')}
            tooltip={props.label ?? t('viewMenus.filterList')}
            as={props.grouped ? ButtonGroup.Button : Button}
            ref={props.triggerRef}
            variant="ghost"
            size={triggerSize()}
            class={props.class}
          >
            <FilterIcon class="size-4 shrink-0" />
            <Show when={props.activeCount}>
              <span class="flex min-w-4 h-4 items-center justify-center rounded-full bg-accent px-1 text-xxs font-medium leading-none text-surface">
                {props.activeCount}
              </span>
            </Show>
          </Dropdown.Trigger>
        }
      >
        {(trigger) => trigger()}
      </Show>
      <Dropdown.Content
        class={cn('min-w-32', props.contentClass)}
        onOpenAutoFocus={(event) => {
          if (!props.aiFilter) return;
          event.preventDefault();
          // Kobalte focuses the menu itself on a deferred tick; land after it.
          setTimeout(() => {
            requestAnimationFrame(() => {
              if (aiFilterInput?.isConnected) {
                aiFilterInput.focus({ preventScroll: true });
              }
            });
          }, 0);
        }}
      >
        <Show when={props.aiFilter}>
          {(aiFilter) => (
            <Dropdown.Group>
              <AiFilterInput
                placeholder={aiFilter().placeholder}
                onSubmit={aiFilter().onSubmit}
                onApplied={() => setOpen(false)}
                inputRef={(element) => {
                  aiFilterInput = element;
                }}
              />
            </Dropdown.Group>
          )}
        </Show>
        <Dropdown.Group>
          {/*
           * Keyed by group id, not by reference: callers derive their groups
           * from queries and flags, so an equivalent-but-new array can arrive
           * mid-interaction, and keying by reference would dispose the row and
           * its open submenu portal instead of updating them in place. Id is
           * still the right boundary — groups come and go from the middle of
           * the list, and a row must not carry one group's open submenu or
           * search text over to another.
           */}
          <Key each={props.groups} by="id">
            {(group) => (
              <Show
                when={group().searchPlaceholder}
                fallback={
                  <FilterSubmenu
                    label={group().label}
                    selectionMode={group().selectionMode}
                    active={isGroupActive(group())}
                    options={group().options}
                    isSelected={(id) => props.isSelected(group().id, id)}
                    onSelect={(id) =>
                      props.onSelectionChange(
                        group().id,
                        id,
                        group().selectionMode === 'single' ||
                          !props.isSelected(group().id, id)
                      )
                    }
                    onOnly={(id) => setSelectedOptionIds(group(), [id])}
                    closeOnSelect
                    contentClass={group().contentClass}
                  />
                }
              >
                <SearchableFilterSubmenu
                  onSelectionComplete={() => setOpen(false)}
                  label={group().label}
                  active={isGroupActive(group())}
                  options={() => group().options}
                  activeIds={() => selectedOptionIds(group())}
                  onChange={(ids) => setSelectedOptionIds(group(), ids)}
                  placeholder={group().searchPlaceholder}
                />
              </Show>
            )}
          </Key>
        </Dropdown.Group>
        <Show when={props.onClear}>
          {(onClear) => (
            <Dropdown.Group>
              <Dropdown.Item class="text-failure-ink" onSelect={onClear()}>
                {props.clearLabel ?? t('viewMenus.clearFilters')}
              </Dropdown.Item>
            </Dropdown.Group>
          )}
        </Show>
        {props.footer}
      </Dropdown.Content>
    </Dropdown>
  );
}
