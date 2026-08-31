import CaretRightIcon from '@phosphor/caret-right.svg';
import CheckIcon from '@phosphor/check.svg';
import FilterIcon from '@phosphor/funnel-simple.svg';
import SortIcon from '@phosphor/sort-ascending.svg';
import GroupIcon from '@phosphor/stack.svg';
import { buttonClasses, cn, Dropdown } from '@ui';
import { For, type JSX, Show } from 'solid-js';

export type ListControlOption<TId extends string> = {
  id: TId;
  label: string;
  icon?: () => JSX.Element;
  disabled?: boolean;
};

type SingleSelectDropdownProps<TId extends string> = {
  label: string;
  icon: JSX.Element;
  value: TId;
  options: ListControlOption<TId>[];
  onChange: (value: TId) => void;
  class?: string;
  contentClass?: string;
};

function SingleSelectDropdown<TId extends string>(
  props: SingleSelectDropdownProps<TId>
) {
  return (
    <Dropdown placement="bottom-end">
      <Dropdown.Trigger
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
  contentClass?: string;
};

export type ListFilterDropdownProps<
  TGroupId extends string,
  TOptionId extends string,
> = {
  groups: ListFilterGroup<TGroupId, TOptionId>[];
  isSelected: (groupId: TGroupId, optionId: TOptionId) => boolean;
  onSelectionChange: (
    groupId: TGroupId,
    optionId: TOptionId,
    selected: boolean
  ) => void;
  onClear?: () => void;
  label?: string;
  clearLabel?: string;
  class?: string;
  contentClass?: string;
};

export function ListFilterDropdown<
  TGroupId extends string,
  TOptionId extends string,
>(props: ListFilterDropdownProps<TGroupId, TOptionId>) {
  return (
    <Dropdown placement="bottom-end">
      <Dropdown.Trigger
        variant="outline"
        size="md"
        square
        depth={2}
        class={cn('rounded-lg bg-surface', props.class)}
        label={props.label ?? 'Filter list'}
      >
        <FilterIcon />
      </Dropdown.Trigger>
      <Dropdown.Content class={cn('min-w-40', props.contentClass)}>
        <Dropdown.Group>
          <For each={props.groups}>
            {(group) => {
              const hasSelection = () =>
                group.options.some((option) =>
                  props.isSelected(group.id, option.id)
                );

              return (
                <Dropdown.Sub>
                  <Dropdown.SubTrigger>
                    <span class="flex-1 text-ink">{group.label}</span>
                    <Show when={hasSelection()}>
                      <span
                        aria-hidden="true"
                        class="size-1.5 shrink-0 rounded-full bg-accent"
                      />
                    </Show>
                    <CaretRightIcon class="size-3 shrink-0 text-ink-muted" />
                  </Dropdown.SubTrigger>
                  <Dropdown.SubContent
                    class={cn(
                      'max-h-72 w-65 max-w-[90vw] overflow-y-auto',
                      group.contentClass
                    )}
                  >
                    <Dropdown.Group>
                      <For each={group.options}>
                        {(option) => (
                          <Dropdown.CheckboxItem
                            checked={props.isSelected(group.id, option.id)}
                            closeOnSelect={false}
                            disabled={option.disabled}
                            onChange={(selected) =>
                              props.onSelectionChange(
                                group.id,
                                option.id,
                                selected
                              )
                            }
                          >
                            <span class="ml-1 flex min-w-0 flex-1 items-center gap-1.5">
                              <Show when={option.icon}>
                                <span
                                  aria-hidden="true"
                                  class="flex size-3.5 shrink-0 items-center justify-center [&_svg]:size-3.5"
                                >
                                  {option.icon?.()}
                                </span>
                              </Show>
                              <span class="flex-1 truncate">
                                {option.label}
                              </span>
                            </span>
                          </Dropdown.CheckboxItem>
                        )}
                      </For>
                    </Dropdown.Group>
                  </Dropdown.SubContent>
                </Dropdown.Sub>
              );
            }}
          </For>
        </Dropdown.Group>
        <Show when={props.onClear}>
          {(onClear) => (
            <Dropdown.Group>
              <Dropdown.Item
                class={buttonClasses({
                  variant: 'strong',
                  size: 'sm',
                  fullWidth: true,
                  class:
                    'rounded-lg text-xs data-highlighted:bg-ink data-highlighted:text-surface-4 data-highlighted:overlay-[color-mix(in_oklch,var(--color-surface-4)_12%,transparent)]',
                })}
                onSelect={onClear()}
              >
                {props.clearLabel ?? 'Clear filters'}
              </Dropdown.Item>
            </Dropdown.Group>
          )}
        </Show>
      </Dropdown.Content>
    </Dropdown>
  );
}
