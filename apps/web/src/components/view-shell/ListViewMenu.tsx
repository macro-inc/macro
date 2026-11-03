import { t } from '@app/lib/i18n';
import { MobileDrawer } from '@components/app/mobile/MobileDrawer';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { deepEqual } from '@core/util/compareUtils';
import CaretRightIcon from '@icon/system/regular/caret-right.svg';
import CheckIcon from '@icon/system/regular/check.svg';
import ViewIcon from '@icon/system/regular/sliders-horizontal.svg';
import SortIcon from '@icon/system/regular/sort-ascending.svg';
import GroupIcon from '@icon/system/regular/stack.svg';
import { Button, ButtonGroup, Dropdown, Tabs } from '@ui';
import { createMemo, createSignal, For, type JSX, Show } from 'solid-js';
import type { ListControlOption, ViewLayout } from './ListDropdowns';

type ViewSelection<T extends string> = {
  value: T;
  options: readonly ListControlOption<T>[];
  onChange: (value: T) => void;
};

export type ListViewMenuProps<TGroup extends string, TSort extends string> = {
  layout?: ViewSelection<ViewLayout>;
  group?: ViewSelection<TGroup>;
  sort?: ViewSelection<TSort> & { disabledReason?: string };
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  triggerRef?: (element: HTMLButtonElement) => void;
  children?: JSX.Element;
};

function selectionLabel<T extends string>(selection: ViewSelection<T>) {
  return selection.options.find((option) => option.id === selection.value)
    ?.label;
}

function DesktopSelection<T extends string>(props: {
  label: string;
  icon: JSX.Element;
  selection: ViewSelection<T>;
  disabledReason?: string;
}) {
  return (
    <Show
      when={!props.disabledReason}
      fallback={
        <Dropdown.Item disabledReason={props.disabledReason}>
          {props.icon}
          <span class="flex-1">{props.label}</span>
          <span class="text-ink-muted">{t('viewMenus.searchOrder')}</span>
        </Dropdown.Item>
      }
    >
      <Dropdown.Sub>
        <Dropdown.SubTrigger>
          {props.icon}
          <span class="flex-1">{props.label}</span>
          <span class="text-ink-muted">{selectionLabel(props.selection)}</span>
          <CaretRightIcon class="size-3 shrink-0 text-ink-muted" />
        </Dropdown.SubTrigger>
        <Dropdown.SubContent class="min-w-48 max-w-80">
          <Dropdown.Group>
            <DesktopOptions selection={props.selection} />
          </Dropdown.Group>
        </Dropdown.SubContent>
      </Dropdown.Sub>
    </Show>
  );
}

function DesktopOptions<T extends string>(props: {
  selection: ViewSelection<T>;
}) {
  return (
    <Dropdown.RadioGroup
      value={props.selection.value}
      onChange={(value) => {
        const option = props.selection.options.find(
          (option) => option.id === value
        );
        if (option) props.selection.onChange(option.id);
      }}
    >
      <For each={props.selection.options}>
        {(option) => (
          <Dropdown.RadioItem
            value={option.id}
            disabled={option.disabled}
            closeOnSelect={false}
          >
            {option.icon?.()}
            <span class="flex-1">{option.label}</span>
            <Dropdown.ItemIndicator>
              <CheckIcon class="size-3.5 text-accent" />
            </Dropdown.ItemIndicator>
          </Dropdown.RadioItem>
        )}
      </For>
    </Dropdown.RadioGroup>
  );
}

function LayoutTabs(props: { selection: ViewSelection<ViewLayout> }) {
  // Keep the radio inputs mounted while the selected layout changes.
  const options = createMemo(
    () =>
      props.selection.options.map((option) => ({
        value: option.id,
        label: option.label,
        icon: option.icon,
        disabled: option.disabled,
      })),
    undefined,
    { equals: deepEqual }
  );
  return (
    <Tabs
      aria-label={t('viewMenus.layout')}
      size="md"
      value={props.selection.value}
      options={options()}
      onChange={props.selection.onChange}
    />
  );
}

function MobileSelection<T extends string>(props: {
  label: string;
  selection: ViewSelection<T>;
  disabledReason?: string;
}) {
  return (
    <div>
      <MobileDrawer.Label>{props.label}</MobileDrawer.Label>
      <Show
        when={!props.disabledReason}
        fallback={
          <p class="px-6 text-sm text-ink-muted">{props.disabledReason}</p>
        }
      >
        <MobileDrawer.Section role="radiogroup" aria-label={props.label}>
          <For each={props.selection.options}>
            {(option) => (
              <MobileDrawer.Item
                role="radio"
                aria-checked={props.selection.value === option.id}
                disabled={option.disabled}
                onClick={() => props.selection.onChange(option.id)}
              >
                {option.icon?.()}
                <span class="flex-1">{option.label}</span>
                <Show when={props.selection.value === option.id}>
                  <CheckIcon class="size-4 shrink-0 text-accent" />
                </Show>
              </MobileDrawer.Item>
            )}
          </For>
        </MobileDrawer.Section>
      </Show>
    </div>
  );
}

/** View presentation only; callers retain layout, grouping, and sort state. */
export function ListViewMenu<TGroup extends string, TSort extends string>(
  props: ListViewMenuProps<TGroup, TSort>
) {
  const [trigger, setTrigger] = createSignal<HTMLButtonElement>();
  return (
    <Show
      when={isTouchDevice()}
      fallback={
        <Dropdown
          open={props.open}
          onOpenChange={props.onOpenChange}
          placement="bottom-end"
        >
          <Dropdown.Trigger
            as={ButtonGroup.Button}
            ref={props.triggerRef}
            aria-label={t('viewMenus.viewOptions')}
            variant="ghost"
            size="md"
          >
            <ViewIcon class="size-4" />
            {t('viewMenus.view')}
          </Dropdown.Trigger>
          <Dropdown.Content
            class={props.layout ? 'w-max' : 'min-w-56 max-w-96'}
          >
            <Show when={props.layout}>
              {(layout) => (
                <Dropdown.Group>
                  <Dropdown.Item
                    role="presentation"
                    closeOnSelect={false}
                    textValue={t('viewMenus.layout')}
                    class="p-0 data-highlighted:bg-transparent"
                    onFocusIn={(
                      event: FocusEvent & { currentTarget: HTMLElement }
                    ) => {
                      if (event.target === event.currentTarget) {
                        event.currentTarget
                          .querySelector<HTMLInputElement>('input:checked')
                          ?.focus();
                      }
                    }}
                  >
                    <LayoutTabs selection={layout()} />
                  </Dropdown.Item>
                </Dropdown.Group>
              )}
            </Show>
            {/* Let only the layout tabs determine the menu's intrinsic width. */}
            <div
              class="flex flex-col divide-y divide-edge-divider"
              classList={{ '[contain:inline-size]': !!props.layout }}
            >
              <Dropdown.Group>
                <Show when={props.group}>
                  {(group) => (
                    <DesktopSelection
                      label={t('viewMenus.groupBy')}
                      icon={<GroupIcon class="size-4 shrink-0" />}
                      selection={group()}
                    />
                  )}
                </Show>
                <Show when={props.sort}>
                  {(sort) => (
                    <DesktopSelection
                      label={t('viewMenus.sort')}
                      icon={<SortIcon class="size-4 shrink-0" />}
                      selection={sort()}
                      disabledReason={sort().disabledReason}
                    />
                  )}
                </Show>
              </Dropdown.Group>
              {props.children}
            </div>
          </Dropdown.Content>
        </Dropdown>
      }
    >
      <MobileDrawer
        open={props.open}
        onOpenChange={props.onOpenChange}
        restoreFocus
        finalFocusEl={trigger()}
      >
        <MobileDrawer.Trigger
          as={Button}
          ref={(element: HTMLButtonElement) => {
            setTrigger(element);
            props.triggerRef?.(element);
          }}
          aria-label={t('viewMenus.viewOptions')}
          variant="secondary"
          size="lg"
          class="shrink-0"
        >
          <ViewIcon class="size-4" />
          {t('viewMenus.view')}
        </MobileDrawer.Trigger>
        <MobileDrawer.Portal>
          <MobileDrawer.Overlay />
          <MobileDrawer.Content>
            <MobileDrawer.Handle />
            <MobileDrawer.Title class="px-6 pb-4 text-lg font-semibold">
              {t('viewMenus.viewOptions')}
            </MobileDrawer.Title>
            <MobileDrawer.ScrollBody class="gap-4">
              <Show when={props.layout}>
                {(layout) => (
                  <div class="px-6">
                    <LayoutTabs selection={layout()} />
                  </div>
                )}
              </Show>
              <Show when={props.group}>
                {(group) => (
                  <MobileSelection
                    label={t('viewMenus.groupBy')}
                    selection={group()}
                  />
                )}
              </Show>
              <Show when={props.sort}>
                {(sort) => (
                  <MobileSelection
                    label={t('viewMenus.sort')}
                    selection={sort()}
                    disabledReason={sort().disabledReason}
                  />
                )}
              </Show>
              {props.children}
            </MobileDrawer.ScrollBody>
          </MobileDrawer.Content>
        </MobileDrawer.Portal>
      </MobileDrawer>
    </Show>
  );
}
