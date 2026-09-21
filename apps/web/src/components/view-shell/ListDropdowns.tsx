import {
  FilterSubmenu,
  SearchableFilterSubmenu,
} from '@app/features/next-soup/soup-view/filters-bar/filter-menu';
import CheckIcon from '@phosphor/check.svg';
import FilterIcon from '@phosphor/funnel-simple.svg';
import SortIcon from '@phosphor/sort-ascending.svg';
import GroupIcon from '@phosphor/stack.svg';
import { cn, Dropdown } from '@ui';
import { batch, For, type JSX, Show } from 'solid-js';

export type ListControlOption<TId extends string> = {
  id: TId;
  label: string;
  icon?: () => JSX.Element;
  disabled?: boolean;
};

type ListDropdownOpenProps = {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
};

type SingleSelectDropdownProps<TId extends string> = {
  label: string;
  icon: JSX.Element;
  value: TId;
  options: ListControlOption<TId>[];
  onChange: (value: TId) => void;
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
        ref={props.triggerRef}
        variant="outline"
        size="md"
        square
        depth={2}
        class={cn('rounded-lg bg-surface', props.class)}
        label={props.label}
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
                      class="flex size-3.5 shrink-0 items-center justify-center [&_svg]:size-3.5"
                    >
                      {option.icon?.()}
                    </span>
                  </Show>
                  <span class="flex-1">{option.label}</span>
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
      label={props.label ?? 'Sort list'}
      icon={<SortIcon />}
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
      label={props.label ?? 'Group list'}
      icon={<GroupIcon />}
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
  isGroupActive?: (groupId: TGroupId) => boolean;
  onSelectionChange: (
    groupId: TGroupId,
    optionId: TOptionId,
    selected: boolean
  ) => void;
  onClear?: () => void;
  customTrigger?: JSX.Element;
  triggerRef?: (element: HTMLButtonElement) => void;
  label?: string;
  clearLabel?: string;
  class?: string;
  contentClass?: string;
} & ListDropdownOpenProps;

export function ListFilterDropdown<
  TGroupId extends string,
  TOptionId extends string,
>(props: ListFilterDropdownProps<TGroupId, TOptionId>) {
  const isGroupActive = (group: ListFilterGroup<TGroupId, TOptionId>) =>
    props.isGroupActive?.(group.id) ??
    group.options.some(
      (option) =>
        option.id !== group.defaultOptionId &&
        props.isSelected(group.id, option.id)
    );

  return (
    <Dropdown
      open={props.open}
      onOpenChange={props.onOpenChange}
      placement="bottom-end"
    >
      <Show
        when={props.customTrigger}
        fallback={
          <Dropdown.Trigger
            ref={props.triggerRef}
            variant="outline"
            size="md"
            square
            depth={2}
            class={cn('rounded-lg bg-surface', props.class)}
            label={props.label ?? 'Filter list'}
          >
            <FilterIcon />
          </Dropdown.Trigger>
        }
      >
        {(trigger) => trigger()}
      </Show>
      <Dropdown.Content class={cn('min-w-32', props.contentClass)}>
        <Dropdown.Group>
          <For each={props.groups}>
            {(group) => (
              <Show
                when={group.searchPlaceholder}
                fallback={
                  <FilterSubmenu
                    label={group.label}
                    selectionMode={group.selectionMode}
                    active={isGroupActive(group)}
                    options={group.options}
                    isSelected={(id) => props.isSelected(group.id, id)}
                    onSelect={(id) =>
                      props.onSelectionChange(
                        group.id,
                        id,
                        group.selectionMode === 'single' ||
                          !props.isSelected(group.id, id)
                      )
                    }
                    closeOnSelect={group.selectionMode === 'single'}
                    contentClass={group.contentClass}
                  />
                }
              >
                <SearchableFilterSubmenu
                  label={group.label}
                  active={isGroupActive(group)}
                  options={() => group.options}
                  activeIds={() =>
                    group.options
                      .filter((option) => props.isSelected(group.id, option.id))
                      .map((option) => option.id)
                  }
                  onChange={(ids) =>
                    batch(() => {
                      for (const option of group.options) {
                        const selected = ids.includes(option.id);
                        if (
                          selected !== props.isSelected(group.id, option.id)
                        ) {
                          props.onSelectionChange(
                            group.id,
                            option.id,
                            selected
                          );
                        }
                      }
                    })
                  }
                  placeholder={group.searchPlaceholder}
                />
              </Show>
            )}
          </For>
        </Dropdown.Group>
        <Show when={props.onClear}>
          {(onClear) => (
            <Dropdown.Group>
              <Dropdown.Item class="text-failure-ink" onSelect={onClear()}>
                {props.clearLabel ?? 'Clear filters'}
              </Dropdown.Item>
            </Dropdown.Group>
          )}
        </Show>
      </Dropdown.Content>
    </Dropdown>
  );
}
