import { t } from '@app/lib/i18n';
import { MobileDrawer } from '@components/app/mobile/MobileDrawer';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { deepEqual } from '@core/util/compareUtils';
import CheckIcon from '@icon/system/regular/check.svg';
import ViewIcon from '@icon/system/regular/sliders-horizontal.svg';
import { Button, ButtonGroup, Popover, Select, Tabs, Tooltip } from '@ui';
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

function DesktopSelection<T extends string>(props: {
  label: string;
  selection: ViewSelection<T>;
  disabledReason?: string;
}) {
  const options = createMemo(() => [...props.selection.options], undefined, {
    equals: deepEqual,
  });
  const selected = () =>
    options().find((option) => option.id === props.selection.value);

  return (
    <Select<ListControlOption<T>>
      class="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-3"
      options={options()}
      value={selected()}
      onChange={(option) => {
        if (option) props.selection.onChange(option.id);
      }}
      optionValue="id"
      optionTextValue="label"
      optionDisabled="disabled"
      disabled={!!props.disabledReason}
      itemComponent={(props) => (
        <Select.Item item={props.item}>
          {props.item.rawValue.icon?.()}
          <Select.ItemLabel>{props.item.rawValue.label}</Select.ItemLabel>
          <Select.ItemIndicator />
        </Select.Item>
      )}
    >
      <Select.Label class="text-sm text-ink-muted">{props.label}</Select.Label>
      <Tooltip
        label={props.disabledReason ?? selected()?.label ?? props.label}
        class="min-w-0 max-w-48 justify-self-end"
      >
        <Select.Trigger class="w-auto max-w-full">
          <Show
            when={!props.disabledReason}
            fallback={
              <span class="min-w-0 flex-1 truncate">
                {t('viewMenus.searchOrder')}
              </span>
            }
          >
            <Select.Value<ListControlOption<T>>>
              {(state) => state.selectedOption()?.label}
            </Select.Value>
          </Show>
          <Select.Icon />
        </Select.Trigger>
      </Tooltip>
      <Select.Content class="max-w-80">
        <Select.Listbox />
      </Select.Content>
    </Select>
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
        <Popover
          open={props.open}
          onOpenChange={props.onOpenChange}
          placement="bottom-end"
        >
          <Popover.Trigger
            as={ButtonGroup.Button}
            ref={props.triggerRef}
            aria-label={t('viewMenus.viewOptions')}
            variant="ghost"
            size="md"
          >
            <ViewIcon class="size-4" />
            {t('viewMenus.view')}
          </Popover.Trigger>
          <Popover.Content
            class={props.layout ? 'w-max p-0' : 'min-w-56 max-w-96 p-0'}
          >
            <Popover.Title class="sr-only">
              {t('viewMenus.viewOptions')}
            </Popover.Title>
            <div class="flex flex-col divide-y divide-edge-divider">
              <Show when={props.layout}>
                {(layout) => (
                  <div class="p-1.5">
                    <LayoutTabs selection={layout()} />
                  </div>
                )}
              </Show>
              {/* Let only the layout tabs determine the popover's width. */}
              <div
                class="flex flex-col divide-y divide-edge-divider"
                classList={{ '[contain:inline-size]': !!props.layout }}
              >
                <div class="flex flex-col gap-2 p-3">
                  <Show when={props.group}>
                    {(group) => (
                      <DesktopSelection
                        label={t('viewMenus.groupBy')}
                        selection={group()}
                      />
                    )}
                  </Show>
                  <Show when={props.sort}>
                    {(sort) => (
                      <DesktopSelection
                        label={t('viewMenus.sort')}
                        selection={sort()}
                        disabledReason={sort().disabledReason}
                      />
                    )}
                  </Show>
                </div>
                {props.children}
              </div>
            </div>
          </Popover.Content>
        </Popover>
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
