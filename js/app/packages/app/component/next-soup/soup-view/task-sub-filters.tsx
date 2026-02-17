import {
  type Component,
  createEffect,
  createMemo,
  createSignal,
  For,
  Show,
} from 'solid-js';
import { Popover } from '@kobalte/core/popover';
import { Hotkey } from '@core/component/Hotkey';
import { PROPERTY_OPTION_IDS } from '@core/component/Properties/constants';
import { PropertyValueIcon } from '@core/component/Properties/component/propertyValue/PropertyValueIcon';
import { useContacts } from '@queries/contacts/contacts';
import { UserIcon } from '@core/component/UserIcon';
import { useDisplayName, tryMacroId } from '@core/user';
import { useSoupView } from '@app/component/next-soup/soup-view/soup-view-context';
import { useKeyPressed } from '@core/util/useKeyPressed';
import SearchIcon from '@icon/regular/magnifying-glass.svg';
import UserCircleIcon from '@icon/regular/user-circle.svg';

const STATUS_OPTIONS = [
  { value: PROPERTY_OPTION_IDS.STATUS.NOT_STARTED, label: 'Not Started' },
  { value: PROPERTY_OPTION_IDS.STATUS.IN_PROGRESS, label: 'In Progress' },
  { value: PROPERTY_OPTION_IDS.STATUS.IN_REVIEW, label: 'In Review' },
  { value: PROPERTY_OPTION_IDS.STATUS.COMPLETED, label: 'Completed' },
  { value: PROPERTY_OPTION_IDS.STATUS.CANCELED, label: 'Canceled' },
] as const;

export const TaskStatusDropdown: Component = () => {
  const { statusFilter, setStatusFilter } = useSoupView();
  const [open, setOpen] = createSignal(false);
  const [searchQuery, setSearchQuery] = createSignal('');
  const [selectedIndex, setSelectedIndex] = createSignal(0);
  const keyboardMode = useKeyPressed(100);

  let searchInputRef!: HTMLInputElement;

  const activeLabel = () => {
    if (!statusFilter()) return 'Status';
    return (
      STATUS_OPTIONS.find((o) => o.value === statusFilter())?.label ?? 'Status'
    );
  };

  const filteredOptions = createMemo(() => {
    const query = searchQuery().toLowerCase().trim();
    if (!query) return [...STATUS_OPTIONS];
    return STATUS_OPTIONS.filter((o) => o.label.toLowerCase().includes(query));
  });

  createEffect(() => {
    const opts = filteredOptions();
    if (opts.length === 0) {
      setSelectedIndex(0);
    } else {
      setSelectedIndex(Math.min(selectedIndex(), opts.length - 1));
    }
  });

  const shouldShowHotkeys = () =>
    !searchQuery().trim() && filteredOptions().length <= 9;

  const selectOption = (value: string | undefined) => {
    setStatusFilter(statusFilter() === value ? undefined : value);
    setOpen(false);
    setSearchQuery('');
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    const opts = filteredOptions();
    if (opts.length === 0) return;

    if (shouldShowHotkeys() && /^[1-9]$/.test(e.key)) {
      e.preventDefault();
      const idx = parseInt(e.key) - 1;
      if (idx < opts.length) selectOption(opts[idx].value);
      return;
    }

    if (e.key === 'ArrowDown' || (e.ctrlKey && e.key === 'j')) {
      e.preventDefault();
      setSelectedIndex((prev) => (prev + 1) % opts.length);
    } else if (e.key === 'ArrowUp' || (e.ctrlKey && e.key === 'k')) {
      e.preventDefault();
      setSelectedIndex((prev) => (prev - 1 + opts.length) % opts.length);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      selectOption(opts[selectedIndex()].value);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      setOpen(false);
      setSearchQuery('');
    }
  };

  return (
    <Popover
      open={open()}
      onOpenChange={(isOpen) => {
        setOpen(isOpen);
        if (isOpen) {
          setSelectedIndex(0);
          setSearchQuery('');
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
          'bg-accent text-panel': !!statusFilter(),
          'text-ink-muted hover:text-accent hover:bg-accent/20':
            !statusFilter(),
        }}
      >
        <Show when={statusFilter()}>
          <PropertyValueIcon optionId={statusFilter()!} class="size-3.5" />
        </Show>
        <span class="leading-none">{activeLabel()}</span>
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
                value={searchQuery()}
                onInput={(e) => setSearchQuery(e.currentTarget.value)}
                onKeyDown={handleKeyDown}
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
                          index() === selectedIndex() ? 'bg-hover' : ''
                        }`}
                        onClick={() => selectOption(option.value)}
                        onMouseEnter={() => {
                          if (!keyboardMode()) setSelectedIndex(index());
                        }}
                      >
                        <PropertyValueIcon optionId={option.value} />
                        <div class="flex-1 text-left">
                          <p class="text-sm font-medium">{option.label}</p>
                        </div>
                        <div class="flex items-center gap-2 flex-shrink-0">
                          <Show when={shouldShowHotkeys() && index() < 9}>
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

const MemberName: Component<{ id: string }> = (props) => {
  const [name] = useDisplayName(tryMacroId(props.id));
  return <span class="truncate">{name() || props.id}</span>;
};

export const TaskAssigneeDropdown: Component = () => {
  const { assigneeFilter, setAssigneeFilter } = useSoupView();
  const [open, setOpen] = createSignal(false);
  const [searchQuery, setSearchQuery] = createSignal('');
  const [selectedIndex, setSelectedIndex] = createSignal(0);
  const keyboardMode = useKeyPressed(100);
  const contacts = useContacts();

  let searchInputRef!: HTMLInputElement;

  const filteredContacts = createMemo(() => {
    const query = searchQuery().toLowerCase().trim();
    const list = contacts();
    if (!query) return list;
    return list.filter(
      (c) =>
        c.name?.toLowerCase().includes(query) ||
        c.id.toLowerCase().includes(query)
    );
  });

  createEffect(() => {
    const list = filteredContacts();
    if (list.length === 0) {
      setSelectedIndex(0);
    } else {
      setSelectedIndex(Math.min(selectedIndex(), list.length - 1));
    }
  });

  const shouldShowHotkeys = () =>
    !searchQuery().trim() && filteredContacts().length <= 9;

  const selectContact = (id: string) => {
    setAssigneeFilter(assigneeFilter() === id ? undefined : id);
    setOpen(false);
    setSearchQuery('');
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    const list = filteredContacts();
    if (list.length === 0) return;

    if (shouldShowHotkeys() && /^[1-9]$/.test(e.key)) {
      e.preventDefault();
      const idx = parseInt(e.key) - 1;
      if (idx < list.length) selectContact(list[idx].id);
      return;
    }

    if (e.key === 'ArrowDown' || (e.ctrlKey && e.key === 'j')) {
      e.preventDefault();
      setSelectedIndex((prev) => (prev + 1) % list.length);
    } else if (e.key === 'ArrowUp' || (e.ctrlKey && e.key === 'k')) {
      e.preventDefault();
      setSelectedIndex((prev) => (prev - 1 + list.length) % list.length);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      selectContact(list[selectedIndex()].id);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      setOpen(false);
      setSearchQuery('');
    }
  };

  return (
    <div class="flex items-center gap-0.5 shrink-0">
      {/* "Assigned to me" quick toggle */}
      <button
        type="button"
        class="flex items-center gap-1 h-[22px] touch:mobile-width:h-9 px-2.5 rounded-full active:bg-accent active:text-panel text-xs"
        classList={{
          'bg-accent text-panel': assigneeFilter() === 'me',
          'text-ink-muted hover:text-accent hover:bg-accent/20':
            assigneeFilter() !== 'me',
        }}
        onClick={() =>
          setAssigneeFilter(assigneeFilter() === 'me' ? undefined : 'me')
        }
      >
        <UserCircleIcon class="size-3.5" />
        <span class="leading-none">Assigned to me</span>
      </button>

      {/* Member picker dropdown */}
      <Popover
        open={open()}
        onOpenChange={(isOpen) => {
          setOpen(isOpen);
          if (isOpen) {
            setSelectedIndex(0);
            setSearchQuery('');
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
            'bg-accent text-panel':
              !!assigneeFilter() && assigneeFilter() !== 'me',
            'text-ink-muted hover:text-accent hover:bg-accent/20':
              !assigneeFilter() || assigneeFilter() === 'me',
          }}
        >
          <UserCircleIcon class="size-3.5" />
          <span class="leading-none">
            <Show
              when={assigneeFilter() && assigneeFilter() !== 'me'}
              fallback="Assignee"
            >
              <MemberName id={assigneeFilter()!} />
            </Show>
          </span>
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
                  value={searchQuery()}
                  onInput={(e) => setSearchQuery(e.currentTarget.value)}
                  onKeyDown={handleKeyDown}
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
                            index() === selectedIndex() ? 'bg-hover' : ''
                          }`}
                          onClick={() => selectContact(contact.id)}
                          onMouseEnter={() => {
                            if (!keyboardMode()) setSelectedIndex(index());
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
                            </p>
                          </div>
                          <div class="flex items-center gap-2 flex-shrink-0">
                            <Show when={shouldShowHotkeys() && index() < 9}>
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
    </div>
  );
};
