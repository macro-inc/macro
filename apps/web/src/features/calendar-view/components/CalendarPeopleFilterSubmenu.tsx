import { UserIcon } from '@core/component/UserIcon';
import { emailToMacroId } from '@core/user/macroId';
import type { IUser } from '@core/user/types';
import CaretRightIcon from '@phosphor/caret-right.svg';
import SearchIcon from '@phosphor/magnifying-glass.svg';
import PlusIcon from '@phosphor/plus.svg';
import { Dropdown } from '@ui';
import * as EmailValidator from 'email-validator';
import {
  type Accessor,
  createEffect,
  createMemo,
  createSignal,
  onCleanup,
  Show,
} from 'solid-js';
import { Virtualizer } from 'virtua/solid';

const CONTACT_ROW_HEIGHT = 32;
const MAX_CONTACT_LIST_HEIGHT = 240;

function FilterLabel(props: { label: string; active: boolean }) {
  return (
    <>
      <span class="flex-1 text-ink">{props.label}</span>
      <Show when={props.active}>
        <span aria-hidden="true" class="size-1.5 rounded-full bg-accent" />
      </Show>
      <CaretRightIcon class="size-3 shrink-0 text-ink-muted" />
    </>
  );
}

/** Search contacts or add an email address that is not in the contact list. */
export function CalendarPeopleFilterSubmenu(props: {
  label: string;
  contacts: Accessor<IUser[]>;
  loading: Accessor<boolean>;
  error: Accessor<boolean>;
  values: Accessor<string[]>;
  onChange: (emails: string[]) => void;
}) {
  const [open, setOpen] = createSignal(false);
  const [search, setSearch] = createSignal('');
  const [inputRef, setInputRef] = createSignal<HTMLInputElement>();
  let listViewport: HTMLDivElement | undefined;
  const [contentRef, setContentRef] = createSignal<HTMLElement>();
  const normalizedSearch = () => search().trim().toLowerCase();
  const scrollToTop = () => {
    if (listViewport?.isConnected) listViewport.scrollTop = 0;
  };
  const matches = createMemo(() => {
    const text = normalizedSearch();
    const contacts = props.contacts();
    const contactEmails = new Set(
      contacts.map((contact) => contact.email.toLowerCase())
    );
    const customSelected: IUser[] = props
      .values()
      .filter((email) => !contactEmails.has(email))
      .map((email) => ({
        id: emailToMacroId(email) ?? email,
        email,
        name: email,
      }));
    return [...customSelected, ...contacts].filter(
      (contact) =>
        contact.name.toLowerCase().includes(text) ||
        contact.email.toLowerCase().includes(text)
    );
  });
  const canAddEmail = () => {
    const email = normalizedSearch();
    return (
      EmailValidator.validate(email) &&
      !props.contacts().some((contact) => contact.email.toLowerCase() === email)
    );
  };
  const toggleEmail = (email: string) => {
    const values = props.values();
    props.onChange(
      values.includes(email)
        ? values.filter((value) => value !== email)
        : [...values, email]
    );
  };
  const setMenuOpen = (next: boolean) => {
    setOpen(next);
    if (!next) setSearch('');
  };

  // Kobalte registers the nested dismissable layer after mounting the submenu.
  // Focus after that registration, and recover focus if the trigger steals it
  // while the pointer crosses into the submenu.
  createEffect(() => {
    const input = inputRef();
    if (!open() || !input) return;
    const frame = requestAnimationFrame(() => {
      if (open()) input.focus();
    });
    const handleBlur = (event: FocusEvent) => {
      const next = event.relatedTarget;
      if (next instanceof Node && contentRef()?.contains(next)) return;
      queueMicrotask(() => {
        if (open() && document.activeElement !== input) input.focus();
      });
    };
    input.addEventListener('blur', handleBlur);
    onCleanup(() => {
      cancelAnimationFrame(frame);
      input.removeEventListener('blur', handleBlur);
    });
  });

  return (
    <Dropdown.Sub open={open()} onOpenChange={setMenuOpen}>
      <Dropdown.SubTrigger
        onPointerEnter={(
          event: PointerEvent & { currentTarget: HTMLElement }
        ) => {
          if (event.pointerType !== 'mouse') return;
          event.currentTarget.focus({ preventScroll: true });
          if (!open()) setMenuOpen(true);
        }}
      >
        <FilterLabel label={props.label} active={props.values().length > 0} />
      </Dropdown.SubTrigger>
      <Dropdown.SubContent
        ref={setContentRef}
        portalScope="local"
        data-calendar-search-filters=""
        class="w-65 max-w-[90vw]"
      >
        <Dropdown.Group class="gap-0 p-0">
          <div class="flex items-center gap-2 border-b border-edge-muted px-3 py-2">
            <SearchIcon class="size-3.5 shrink-0 text-ink-muted" />
            <input
              ref={setInputRef}
              type="text"
              aria-label={`Search ${props.label.toLowerCase()} contacts`}
              placeholder="Search contacts or enter email"
              value={search()}
              onInput={(event) => {
                setSearch(event.currentTarget.value);
                scrollToTop();
              }}
              onKeyDown={(event) => {
                if (event.key === 'Escape' || event.key === 'ArrowDown') return;
                event.stopPropagation();
              }}
              class="min-w-0 flex-1 bg-transparent text-sm text-ink outline-none placeholder:text-ink-placeholder"
            />
          </div>
          <Show
            when={!props.loading()}
            fallback={
              <div
                role="status"
                aria-label="Loading contacts"
                class="space-y-1 p-1"
              >
                <div class="skeleton-shimmer h-8 rounded-md bg-skeleton" />
                <div class="skeleton-shimmer h-8 rounded-md bg-skeleton" />
              </div>
            }
          >
            <Show when={matches().length > 0}>
              <div
                ref={(element) => (listViewport = element)}
                class="overflow-y-auto p-1"
                style={{
                  height: `${Math.min(
                    matches().length * CONTACT_ROW_HEIGHT + 8,
                    MAX_CONTACT_LIST_HEIGHT
                  )}px`,
                }}
              >
                <Virtualizer data={matches()} itemSize={CONTACT_ROW_HEIGHT}>
                  {(contact) => (
                    <Dropdown.CheckboxItem
                      class="h-8"
                      closeOnSelect={false}
                      checked={props
                        .values()
                        .includes(contact.email.toLowerCase())}
                      onChange={() => toggleEmail(contact.email.toLowerCase())}
                    >
                      <UserIcon
                        id={contact.id}
                        size="sm"
                        suppressClick
                        showTooltip={false}
                      />
                      <span class="min-w-0 flex-1 truncate">
                        {contact.name}
                      </span>
                    </Dropdown.CheckboxItem>
                  )}
                </Virtualizer>
              </div>
            </Show>
          </Show>
          <Show when={canAddEmail()}>
            <Dropdown.Item
              closeOnSelect={false}
              onSelect={() => {
                const email = normalizedSearch();
                inputRef()?.focus();
                toggleEmail(email);
                setSearch('');
                queueMicrotask(scrollToTop);
              }}
            >
              <PlusIcon class="size-3.5" />
              <span class="min-w-0 flex-1 truncate">
                {props.values().includes(normalizedSearch()) ? 'Remove' : 'Add'}{' '}
                {normalizedSearch()}
              </span>
            </Dropdown.Item>
          </Show>
          <Show
            when={!props.loading() && matches().length === 0 && !canAddEmail()}
          >
            <div class="px-2 py-3 text-center text-xs text-ink-muted">
              {props.error()
                ? 'Contacts unavailable. Enter an email instead.'
                : normalizedSearch()
                  ? 'No matching contacts'
                  : 'No contacts available'}
            </div>
          </Show>
        </Dropdown.Group>
      </Dropdown.SubContent>
    </Dropdown.Sub>
  );
}
