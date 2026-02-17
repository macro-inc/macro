import { type Component, createMemo, For, Show } from 'solid-js';
import { Popover } from '@kobalte/core/popover';
import { Hotkey } from '@core/component/Hotkey';
import { TASK_STATUS_OPTIONS } from '@entity';
import { PropertyValueIcon } from '@core/component/Properties/component/propertyValue/PropertyValueIcon';
import { useContacts } from '@queries/contacts/contacts';
import { UserIcon } from '@core/component/UserIcon';
import { useSoupView } from '@app/component/next-soup/soup-view/soup-view-context';
import { useDropdownSearch } from '@core/util/useDropdownSearch';
import { useUserId } from '@core/context/user';
import SearchIcon from '@icon/regular/magnifying-glass.svg';
import UserCircleIcon from '@icon/regular/user-circle.svg';
import CaretDownIcon from '@icon/regular/caret-down.svg';
import XIcon from '@icon/regular/x.svg?component-solid';
import CircleDashedIcon from '@icon/regular/circle-dashed.svg';

type DropdownProps = {
  open: () => boolean;
  onOpenChange: (isOpen: boolean) => void;
};

export const TaskStatusDropdown: Component<DropdownProps> = (props) => {
  const { statusFilter, setStatusFilter } = useSoupView();
  const open = () => props.open();
  const setOpen = (v: boolean) => props.onOpenChange(v);

  let searchInputRef!: HTMLInputElement;

  const activeLabel = () => {
    if (!statusFilter()) return 'Status';
    return (
      TASK_STATUS_OPTIONS.find((o) => o.value === statusFilter())?.label ??
      'Status'
    );
  };

  const selectOption = (value: string | undefined) => {
    setStatusFilter(statusFilter() === value ? undefined : value);
    setOpen(false);
    dropdown.reset();
  };

  const dropdown = useDropdownSearch({
    itemCount: () => filteredOptions().length,
    onSelect: (idx) => selectOption(filteredOptions()[idx].value),
    onClose: () => {
      setOpen(false);
      dropdown.reset();
    },
  });

  const filteredOptions = createMemo(() => {
    const query = dropdown.searchQuery().toLowerCase().trim();
    if (!query) return [...TASK_STATUS_OPTIONS];
    return TASK_STATUS_OPTIONS.filter((o) =>
      o.label.toLowerCase().includes(query)
    );
  });

  return (
    <Popover
      open={open()}
      onOpenChange={(isOpen) => {
        setOpen(isOpen);
        if (isOpen) {
          dropdown.reset();
          setTimeout(() => searchInputRef?.focus(), 0);
        }
      }}
      placement="bottom-start"
      gutter={4}
    >
      <Popover.Trigger
        as="button"
        type="button"
        class="flex items-center gap-1 h-[22px] touch:mobile-width:h-9 px-2.5 shrink-0 rounded-full active:bg-accent active:text-panel text-xs"
        classList={{
          'bg-accent/20 text-accent': !!statusFilter(),
          'text-ink-muted hover:text-accent hover:bg-accent/20':
            !statusFilter(),
        }}
      >
        <Show
          when={statusFilter()}
          fallback={<CircleDashedIcon class="size-3.5" />}
        >
          <PropertyValueIcon optionId={statusFilter()!} class="size-3.5" />
        </Show>
        <span class="leading-none">{activeLabel()}</span>
        <Show
          when={statusFilter()}
          fallback={<CaretDownIcon class="size-3 opacity-60" />}
        >
          <span
            class="ml-0.5 hover:text-accent/60"
            onClick={(e) => {
              e.stopPropagation();
              e.preventDefault();
              setStatusFilter(undefined);
            }}
          >
            <XIcon class="size-3" />
          </span>
        </Show>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content class="z-50 bg-panel border border-edge-muted shadow-lg min-w-[180px]">
          <div>
            <div class="flex w-full items-center py-1 gap-2 px-2 border-b border-edge-muted">
              <SearchIcon class="h-4 w-4 text-ink-muted" />
              <input
                class="w-full caret-accent"
                ref={searchInputRef}
                type="text"
                value={dropdown.searchQuery()}
                onInput={(e) => dropdown.setSearchQuery(e.currentTarget.value)}
                onKeyDown={dropdown.handleKeyDown}
                placeholder="Filter status..."
              />
            </div>
            <div class="p-1">
              <div class="max-h-[200px] overflow-y-auto overflow-x-hidden scrollbar-hidden">
                <Show
                  when={filteredOptions().length > 0}
                  fallback={
                    <div class="text-center py-4 text-ink-muted text-sm">
                      No options match your search
                    </div>
                  }
                >
                  <For each={filteredOptions()}>
                    {(option, index) => (
                      <div
                        class={`flex flex-row w-full justify-between items-center gap-2 py-1.5 px-2 ${
                          index() === dropdown.selectedIndex() ? 'bg-hover' : ''
                        }`}
                        onClick={() => selectOption(option.value)}
                        onMouseEnter={() => {
                          if (!dropdown.keyboardMode())
                            dropdown.setSelectedIndex(index());
                        }}
                      >
                        <PropertyValueIcon optionId={option.value} />
                        <div class="flex-1 text-left">
                          <p class="text-sm font-medium">{option.label}</p>
                        </div>
                        <div class="flex items-center gap-2 flex-shrink-0">
                          <Show
                            when={dropdown.shouldShowHotkeys() && index() < 9}
                          >
                            <div class="text-[0.625rem] px-1.5 py-0.5 border border-edge-muted text-ink-muted font-mono rounded-xs">
                              <Hotkey shortcut={`${index() + 1}`} />
                            </div>
                          </Show>
                          <Show when={statusFilter() === option.value}>
                            <span class="text-accent text-sm">✓</span>
                          </Show>
                        </div>
                      </div>
                    )}
                  </For>
                </Show>
              </div>
            </div>
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover>
  );
};

export const TaskAssigneeDropdown: Component<DropdownProps> = (props) => {
  const { assigneeFilter, setAssigneeFilter } = useSoupView();
  const open = () => props.open();
  const setOpen = (v: boolean) => props.onOpenChange(v);
  const contacts = useContacts();
  const userId = useUserId();

  let searchInputRef!: HTMLInputElement;

  const sortedContacts = createMemo(() => {
    const list = contacts();
    const me = userId();
    if (!me) return list;
    const myIndex = list.findIndex((c) => c.id === me);
    if (myIndex <= 0) return list;
    const sorted = [...list];
    const [myContact] = sorted.splice(myIndex, 1);
    sorted.unshift(myContact);
    return sorted;
  });

  const selectContact = (id: string) => {
    setAssigneeFilter(assigneeFilter() === id ? undefined : id);
    setOpen(false);
    dropdown.reset();
  };

  const dropdown = useDropdownSearch({
    itemCount: () => filteredContacts().length,
    onSelect: (idx) => selectContact(filteredContacts()[idx].id),
    onClose: () => {
      setOpen(false);
      dropdown.reset();
    },
  });

  const filteredContacts = createMemo(() => {
    const query = dropdown.searchQuery().toLowerCase().trim();
    const list = sortedContacts();
    if (!query) return list;
    return list.filter(
      (c) =>
        c.name?.toLowerCase().includes(query) ||
        c.id.toLowerCase().includes(query)
    );
  });

  const activeAssigneeLabel = () => {
    if (!assigneeFilter()) return 'Assignee';
    const contact = contacts().find((c) => c.id === assigneeFilter());
    if (contact && contact.id === userId())
      return contact.name ? `${contact.name} (me)` : 'Me';
    return contact?.name || assigneeFilter()!;
  };

  return (
    <Popover
      open={open()}
      onOpenChange={(isOpen) => {
        setOpen(isOpen);
        if (isOpen) {
          dropdown.reset();
          setTimeout(() => searchInputRef?.focus(), 0);
        }
      }}
      placement="bottom-start"
      gutter={4}
    >
      <Popover.Trigger
        as="button"
        type="button"
        class="flex items-center gap-1 h-[22px] touch:mobile-width:h-9 px-2.5 shrink-0 rounded-full active:bg-accent active:text-panel text-xs"
        classList={{
          'bg-accent/20 text-accent': !!assigneeFilter(),
          'text-ink-muted hover:text-accent hover:bg-accent/20':
            !assigneeFilter(),
        }}
      >
        <Show
          when={assigneeFilter()}
          fallback={<UserCircleIcon class="size-3.5" />}
        >
          <UserIcon
            id={assigneeFilter()!}
            size="xs"
            suppressClick
            showTooltip={false}
          />
        </Show>
        <span class="leading-none">{activeAssigneeLabel()}</span>
        <Show
          when={assigneeFilter()}
          fallback={<CaretDownIcon class="size-3 opacity-60" />}
        >
          <span
            class="ml-0.5 hover:text-accent/60"
            onClick={(e) => {
              e.stopPropagation();
              e.preventDefault();
              setAssigneeFilter(undefined);
            }}
          >
            <XIcon class="size-3" />
          </span>
        </Show>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content class="z-50 bg-panel border border-edge-muted shadow-lg min-w-[200px]">
          <div>
            <div class="flex w-full items-center py-1 gap-2 px-2 border-b border-edge-muted">
              <SearchIcon class="h-4 w-4 text-ink-muted" />
              <input
                class="w-full caret-accent"
                ref={searchInputRef}
                type="text"
                value={dropdown.searchQuery()}
                onInput={(e) => dropdown.setSearchQuery(e.currentTarget.value)}
                onKeyDown={dropdown.handleKeyDown}
                placeholder="Filter assignee..."
              />
            </div>
            <div class="p-1">
              <div class="max-h-[200px] overflow-y-auto overflow-x-hidden scrollbar-hidden">
                <Show
                  when={filteredContacts().length > 0}
                  fallback={
                    <div class="text-center py-4 text-ink-muted text-sm">
                      No members match your search
                    </div>
                  }
                >
                  <For each={filteredContacts()}>
                    {(contact, index) => (
                      <div
                        class={`flex flex-row w-full justify-between items-center gap-2 py-1.5 px-2 ${
                          index() === dropdown.selectedIndex() ? 'bg-hover' : ''
                        }`}
                        onClick={() => selectContact(contact.id)}
                        onMouseEnter={() => {
                          if (!dropdown.keyboardMode())
                            dropdown.setSelectedIndex(index());
                        }}
                      >
                        <UserIcon
                          id={contact.id}
                          size="xs"
                          suppressClick
                          showTooltip={false}
                        />
                        <div class="flex-1 text-left">
                          <p class="text-sm font-medium">
                            {contact.name || contact.id}
                            <Show when={contact.id === userId()}>
                              <span class="text-ink-muted ml-1">(me)</span>
                            </Show>
                          </p>
                        </div>
                        <div class="flex items-center gap-2 flex-shrink-0">
                          <Show
                            when={dropdown.shouldShowHotkeys() && index() < 9}
                          >
                            <div class="text-[0.625rem] px-1.5 py-0.5 border border-edge-muted text-ink-muted font-mono rounded-xs">
                              <Hotkey shortcut={`${index() + 1}`} />
                            </div>
                          </Show>
                          <Show when={assigneeFilter() === contact.id}>
                            <span class="text-accent text-sm">✓</span>
                          </Show>
                        </div>
                      </div>
                    )}
                  </For>
                </Show>
              </div>
            </div>
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover>
  );
};
