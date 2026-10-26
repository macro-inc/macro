import { getInitialsFromName } from '@core/user/displayName';
import { useSelectedFirst } from '@core/util/useSelectedFirst';
import CaretDown from '@icon/system/regular/caret-down.svg';
import Check from '@icon/system/regular/check.svg';
import Search from '@icon/system/regular/magnifying-glass.svg';
import Users from '@icon/system/regular/users.svg';
import type { CollectionNode } from '@kobalte/core';
import { Combobox, useComboboxContext } from '@kobalte/core/combobox';
import { Avatar, Button, Layer } from '@ui';
import { type Accessor, createMemo, createSignal, Show } from 'solid-js';
import { Virtualizer, type VirtualizerHandle } from 'virtua/solid';
import type { SchedulingMember } from '../core/types';

type HostOption = {
  id: string;
  label: string;
  email: string;
  missing: boolean;
};

function HostSearch(props: { ref: (input: HTMLInputElement) => void }) {
  const context = useComboboxContext();
  // Virtual rows can mount after Kobalte computes its DOM-based active ID.
  const activeOptionId = () => {
    const key = context.listState().selectionManager().focusedKey();
    return key == null ? undefined : context.generateId(`host-${key}`);
  };
  return (
    <div class="flex shrink-0 items-center gap-2 border-b border-edge-muted px-3 py-2">
      <Search class="size-3.5 shrink-0 text-ink-muted" aria-hidden="true" />
      <Combobox.Input
        ref={props.ref}
        aria-label="Search team hosts"
        aria-activedescendant={activeOptionId()}
        placeholder="Search hosts…"
        class="min-w-0 flex-1 bg-transparent text-sm text-ink caret-accent outline-none placeholder:text-ink-placeholder"
      />
    </div>
  );
}
function HostListbox() {
  const context = useComboboxContext();
  let virtualizer: VirtualizerHandle | undefined;
  let visibleItems: Accessor<Iterable<CollectionNode<HostOption>>> | undefined;
  return (
    <Combobox.Listbox<HostOption>
      aria-label="Team hosts"
      class="min-h-0 max-h-60 overflow-y-auto overscroll-contain scrollbar-hidden"
      scrollToItem={(key) => {
        const index = [...(visibleItems?.() ?? [])].findIndex(
          (item) => item.rawValue.id === key
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
                  id={context.generateId(`host-${item.key}`)}
                  onMouseDown={(event) => {
                    // Keep search focused instead of the dialog ancestor.
                    event.preventDefault();
                  }}
                  class="group flex w-full items-center gap-1.5 rounded-lg px-2 py-1.5 text-left text-sm font-normal outline-none data-highlighted:bg-ink/5"
                >
                  <span class="flex size-3.5 shrink-0 items-center justify-center rounded-sm border border-transparent text-surface group-data-selected:border-accent group-data-selected:bg-accent group-data-highlighted:border-edge-muted">
                    <Combobox.ItemIndicator>
                      <Check class="size-2.5" />
                    </Combobox.ItemIndicator>
                  </span>
                  <Avatar size="sm" aria-hidden="true">
                    <Avatar.Fallback>
                      {getInitialsFromName(
                        item.rawValue.label,
                        item.rawValue.email
                      )}
                    </Avatar.Fallback>
                  </Avatar>
                  <Combobox.ItemLabel class="min-w-0 flex-1 truncate">
                    {item.rawValue.label}
                    <Show when={item.rawValue.email !== item.rawValue.label}>
                      <span class="sr-only">{` (${item.rawValue.email})`}</span>
                    </Show>
                  </Combobox.ItemLabel>
                  <Show when={item.rawValue.missing}>
                    <span class="shrink-0 text-xs text-warning">
                      Former member
                    </span>
                  </Show>
                </Combobox.Item>
              )}
            </Virtualizer>
          </Show>
        );
      }}
    </Combobox.Listbox>
  );
}

/** A draft-only host selection; the owner supplies members and persists changes. */
export function BookingHostSelector(props: {
  members: SchedulingMember[];
  value: string[];
  disabled: boolean;
  invalid: boolean;
  descriptionId?: string;
  onChange: (hosts: string[]) => void;
}) {
  let trigger: HTMLButtonElement | undefined;
  let search: HTMLInputElement | undefined;
  let restoreTriggerFocus = true;
  const [open, setOpen] = createSignal(false);
  const [searchQuery, setSearchQuery] = createSignal('');
  const options = createMemo<HostOption[]>(
    () => [
      ...props.members.map((member) => ({
        id: member.id,
        label: member.name || member.email,
        email: member.email,
        missing: false,
      })),
      ...props.value
        .filter((id) => !props.members.some((member) => member.id === id))
        .map((id) => ({ id, label: id, email: id, missing: true })),
    ],
    [],
    {
      // Selection alone must not invalidate the open menu's selected-first order.
      equals: (previous, next) =>
        previous.length === next.length &&
        previous.every((option, index) => {
          const other = next[index];
          return (
            option.id === other.id &&
            option.label === other.label &&
            option.email === other.email &&
            option.missing === other.missing
          );
        }),
    }
  );
  const selected = createMemo(() =>
    options().filter((option) => props.value.includes(option.id))
  );
  const sortedOptions = useSelectedFirst({
    items: options,
    selectedIds: () => props.value,
    searchQuery,
    getId: (option) => option.id,
    sortDeps: [open],
  });
  const label = () =>
    selected().length === 1
      ? selected()[0].label
      : selected().length
        ? `${selected().length} hosts`
        : 'Select hosts';
  const changeOpen = (next: boolean) => {
    if (next && props.disabled) return;
    if (next) restoreTriggerFocus = true;
    setOpen(next);
    if (!next) setSearchQuery('');
  };
  return (
    <Combobox<HostOption>
      multiple
      selectionBehavior="toggle"
      closeOnSelection={false}
      open={open() && !props.disabled}
      onOpenChange={changeOpen}
      disabled={props.disabled}
      options={sortedOptions()}
      value={selected()}
      onChange={(hosts) => {
        if (props.disabled) return;
        props.onChange(hosts.map((host) => host.id));
      }}
      onInputChange={setSearchQuery}
      optionValue="id"
      optionTextValue={(option) => `${option.label} ${option.email}`}
      optionLabel={() => ''}
      virtualized
      allowsEmptyCollection
      removeOnBackspace={false}
      modal={false}
      placement="bottom-start"
      flip={false}
      gutter={4}
    >
      <Combobox.Control>
        <Combobox.Trigger
          as={Button}
          ref={trigger}
          variant="outline"
          aria-label="Team hosts"
          aria-invalid={props.invalid ? true : undefined}
          aria-describedby={props.descriptionId}
          tabIndex={0}
          onKeyDown={(event: KeyboardEvent) => {
            if (!['Enter', ' ', 'ArrowDown', 'ArrowUp'].includes(event.key))
              return;
            event.preventDefault();
            changeOpen(true);
            queueMicrotask(() => {
              if (open() && !props.disabled && search?.isConnected)
                search.focus();
            });
          }}
          class="h-9 w-full justify-between rounded-lg px-3 font-normal aria-invalid:ring-2 aria-invalid:ring-failure/30 data-expanded:overlay-active"
        >
          <Users class="size-4 shrink-0 text-ink-muted" aria-hidden="true" />
          <span class="min-w-0 flex-1 truncate text-left">{label()}</span>
          <CaretDown
            class="size-3 shrink-0 text-ink-extra-muted"
            aria-hidden="true"
          />
        </Combobox.Trigger>
      </Combobox.Control>
      <Combobox.Portal>
        <Layer depth={2}>
          <Combobox.Content
            data-kb-top-layer
            onKeyDown={(event) => {
              if (event.key !== 'Escape') return;
              event.preventDefault();
              event.stopPropagation();
              changeOpen(false);
            }}
            onInteractOutside={() => {
              restoreTriggerFocus = false;
            }}
            onCloseAutoFocus={(event) => {
              // The search unmounts with the popup; restore its trigger instead.
              event.preventDefault();
              changeOpen(false);
              if (
                restoreTriggerFocus &&
                trigger?.isConnected &&
                !props.disabled
              )
                trigger.focus({ preventScroll: true });
            }}
            class="menu-surface z-action-menu flex max-h-[var(--kb-popper-content-available-height)] w-72 max-w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-xl text-sm menu-open-animation"
          >
            <HostSearch
              ref={(input) => {
                search = input;
              }}
            />
            <div class="flex min-h-0 flex-col p-1">
              <HostListbox />
            </div>
          </Combobox.Content>
        </Layer>
      </Combobox.Portal>
    </Combobox>
  );
}
