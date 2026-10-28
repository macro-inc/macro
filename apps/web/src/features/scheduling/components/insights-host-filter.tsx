import { getInitialsFromName } from '@core/user/displayName';
import { useSelectedFirst } from '@core/util/useSelectedFirst';
import CaretDownIcon from '@icon/system/regular/caret-down.svg';
import CheckIcon from '@icon/system/regular/check.svg';
import SearchIcon from '@icon/system/regular/magnifying-glass.svg';
import UsersIcon from '@icon/system/regular/users.svg';
import type { CollectionNode } from '@kobalte/core';
import { Combobox } from '@kobalte/core/combobox';
import { Avatar, Button, Layer } from '@ui';
import {
  type Accessor,
  createMemo,
  createSignal,
  type JSX,
  Show,
} from 'solid-js';
import { Virtualizer, type VirtualizerHandle } from 'virtua/solid';

import {
  type InsightHostOption,
  insightHostSelection,
} from '../core/insight-host-options';

export function InsightHostAvatar(props: {
  host: InsightHostOption;
  photoUrl?: string;
}) {
  return (
    <Avatar size="sm" aria-hidden="true">
      <Show when={props.photoUrl}>
        {(url) => <Avatar.Image src={url()} alt="" />}
      </Show>
      <Avatar.Fallback>
        <Show
          when={props.host.value === 'all'}
          fallback={getInitialsFromName(
            props.host.label,
            props.host.email ?? ''
          )}
        >
          <UsersIcon class="size-3" />
        </Show>
      </Avatar.Fallback>
    </Avatar>
  );
}

function HostListbox(props: {
  renderAvatar?: (host: InsightHostOption) => JSX.Element;
}) {
  let virtualizer: VirtualizerHandle | undefined;
  let visibleItems:
    | Accessor<Iterable<CollectionNode<InsightHostOption>>>
    | undefined;

  return (
    <Combobox.Listbox<InsightHostOption>
      aria-label="Hosts"
      class="min-h-0 max-h-60 overflow-y-auto overscroll-contain scrollbar-hidden"
      scrollToItem={(key) => {
        const index = [...(visibleItems?.() ?? [])].findIndex(
          (item) => item.rawValue.value === key
        );
        if (index !== -1)
          virtualizer?.scrollToIndex(index, { align: 'nearest' });
      }}
    >
      {(items) => {
        visibleItems = items;
        const rows = () => [...items()];
        return (
          <Show
            when={rows().length}
            fallback={
              <div
                role="status"
                class="px-2 py-3 text-center text-xs text-ink-muted"
              >
                No hosts found
              </div>
            }
          >
            <Virtualizer
              ref={(handle) => {
                virtualizer = handle;
              }}
              data={rows()}
              itemSize={36}
            >
              {(item) => (
                <Combobox.Item
                  item={item}
                  // Keep virtual focus in the search input inside parent popovers.
                  on:mousedown={(event: MouseEvent) => event.preventDefault()}
                  class="group rounded-lg w-full flex items-center gap-1.5 p-1.5 px-2 text-left text-sm font-normal data-highlighted:bg-ink/5 cursor-default outline-none"
                >
                  {props.renderAvatar?.(item.rawValue) ?? (
                    <InsightHostAvatar host={item.rawValue} />
                  )}
                  <Combobox.ItemLabel class="min-w-0 flex-1 truncate">
                    {item.rawValue.label}
                    <Show
                      when={
                        item.rawValue.value !== 'all' &&
                        (item.rawValue.email ?? item.rawValue.value) !==
                          item.rawValue.label
                      }
                    >
                      <span class="sr-only">
                        {` (${item.rawValue.email ?? item.rawValue.value})`}
                      </span>
                    </Show>
                  </Combobox.ItemLabel>
                  <span class="flex size-3.5 shrink-0 items-center justify-center text-accent">
                    <Combobox.ItemIndicator>
                      <CheckIcon class="size-3.5" />
                    </Combobox.ItemIndicator>
                  </span>
                </Combobox.Item>
              )}
            </Virtualizer>
          </Show>
        );
      }}
    </Combobox.Listbox>
  );
}

export function InsightsHostFilter(props: {
  options: InsightHostOption[];
  value: string;
  onChange: (value: string) => void;
  renderAvatar?: (host: InsightHostOption) => JSX.Element;
}) {
  let trigger: HTMLButtonElement | undefined;
  let search: HTMLInputElement | undefined;
  let restoreTriggerFocus = true;
  const [open, setOpen] = createSignal(false);
  const [searchQuery, setSearchQuery] = createSignal('');
  const selected = createMemo<InsightHostOption>((previous) =>
    insightHostSelection(props.options, props.value, previous)
  );
  const options = () =>
    props.options.some((option) => option.value === selected().value)
      ? props.options
      : [...props.options, selected()];
  const sortedOptions = useSelectedFirst({
    items: options,
    selectedIds: () => [props.value],
    searchQuery,
    getId: (option) => option.value,
    sortDeps: [open],
  });

  return (
    <Combobox<InsightHostOption>
      open={open()}
      onOpenChange={(next) => {
        if (next) restoreTriggerFocus = true;
        setOpen(next);
        if (!next) setSearchQuery('');
      }}
      options={sortedOptions()}
      value={selected()}
      onChange={(option) => option && props.onChange(option.value)}
      onInputChange={setSearchQuery}
      optionValue="value"
      optionTextValue={(option) =>
        `${option.label} ${option.email ?? ''}`.trim()
      }
      optionLabel={() => ''}
      virtualized
      allowsEmptyCollection
      modal={false}
      placement="bottom-start"
      gutter={4}
    >
      <Combobox.Control>
        <Combobox.Trigger
          as={Button}
          variant="outline"
          ref={trigger}
          aria-label="Filter hosts"
          tabIndex={0}
          onKeyDown={(event: KeyboardEvent) => {
            if (!['Enter', ' ', 'ArrowDown', 'ArrowUp'].includes(event.key))
              return;
            event.preventDefault();
            restoreTriggerFocus = true;
            setOpen(true);
            queueMicrotask(() => search?.focus());
          }}
          class="w-full justify-between px-2 font-normal data-expanded:overlay-active data-expanded:text-ink"
        >
          <span class="min-w-0 flex-1 truncate text-left">
            {selected().label}
          </span>
          <CaretDownIcon class="size-3 text-ink-extra-muted" />
        </Combobox.Trigger>
      </Combobox.Control>
      <Combobox.Portal
        mount={trigger?.closest<HTMLElement>('.portal-scope') ?? undefined}
      >
        <Layer depth={2}>
          <Combobox.Content
            onInteractOutside={() => {
              restoreTriggerFocus = false;
            }}
            onCloseAutoFocus={(event) => {
              // The search lives in the popup, so Kobalte's default input focus
              // targets an unmounted element. Return to the trigger instead.
              event.preventDefault();
              if (restoreTriggerFocus && trigger?.isConnected) {
                trigger.focus({ preventScroll: true });
              }
            }}
            class="menu-surface z-action-menu flex max-h-[var(--kb-popper-content-available-height)] w-65 max-w-[90vw] flex-col overflow-hidden rounded-xl text-sm menu-open-animation"
          >
            <div class="flex shrink-0 items-center gap-2 px-3 py-2 border-b border-edge-muted">
              <SearchIcon class="size-3.5 shrink-0 text-ink-muted" />
              <Combobox.Input
                ref={search}
                aria-label="Search hosts"
                placeholder="Search hosts…"
                class="min-w-0 flex-1 bg-transparent text-sm text-ink caret-accent outline-none placeholder:text-ink-placeholder"
              />
            </div>
            <div class="flex min-h-0 flex-col p-1">
              <HostListbox renderAvatar={props.renderAvatar} />
            </div>
          </Combobox.Content>
        </Layer>
      </Combobox.Portal>
    </Combobox>
  );
}
