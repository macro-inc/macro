import { UserIcon } from '@core/component/UserIcon';
import { emailToMacroId } from '@core/user/macroId';
import type { IUser } from '@core/user/types';
import CaretRightIcon from '@icon/system/regular/caret-right.svg';
import SearchIcon from '@icon/system/regular/magnifying-glass.svg';
import PlusIcon from '@icon/system/regular/plus.svg';
import type { ContactFilterSourceFactory } from '@queries/contacts/filter-source';
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
  createSource: ContactFilterSourceFactory;
  parentOpen: Accessor<boolean>;
  values: Accessor<string[]>;
  onChange: (emails: string[]) => void;
}) {
  const [open, setOpen] = createSignal(false);
  const source = props.createSource(
    props.values,
    () => props.parentOpen() && open()
  );
  const search = source.suggestions.search;
  const setSearch = source.suggestions.setSearch;
  const contacts = () => source.suggestions.data()?.users ?? [];
  const loading = source.suggestions.loading;
  const error = source.suggestions.error;
  const [inputRef, setInputRef] = createSignal<HTMLInputElement>();
  let listViewport: HTMLDivElement | undefined;
  const [contentRef, setContentRef] = createSignal<HTMLElement>();
  const normalizedSearch = () => search().trim().toLowerCase();
  const scrollToTop = () => {
    if (listViewport?.isConnected) listViewport.scrollTop = 0;
  };
  const matches = createMemo(() => {
    const text = normalizedSearch();
    const suggestions = contacts();
    const suggestionEmails = new Set(
      suggestions.map((contact) => contact.email.toLowerCase())
    );
    const resolved = new Map(
      [...suggestions, ...(source.selection.data()?.users ?? [])].map(
        (contact) => [contact.email.toLowerCase(), contact]
      )
    );
    const selectedEmails = new Set(
      props.values().map((email) => email.trim().toLowerCase())
    );
    const selected: IUser[] = [...selectedEmails].map(
      (email) =>
        resolved.get(email) ?? {
          id: emailToMacroId(email) ?? email,
          email,
          name: email,
        }
    );
    // Suggestions have already been filtered/ranked before the page limit. Only
    // the independent selection is filtered here, never the returned window.
    return [
      ...selected.filter(
        (contact) =>
          suggestionEmails.has(contact.email.toLowerCase()) ||
          contact.name.toLowerCase().includes(text) ||
          contact.email.toLowerCase().includes(text)
      ),
      ...suggestions.filter(
        (contact) => !selectedEmails.has(contact.email.toLowerCase())
      ),
    ];
  });
  const canAddEmail = () => {
    const email = normalizedSearch();
    return (
      EmailValidator.validate(email) &&
      ![...contacts(), ...(source.selection.data()?.users ?? [])].some(
        (contact) => contact.email.toLowerCase() === email
      )
    );
  };
  const toggleEmail = (email: string) => {
    const values = props.values();
    props.onChange(
      values.some((value) => value.trim().toLowerCase() === email)
        ? values.filter((value) => value.trim().toLowerCase() !== email)
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
    const isContentControl = (target: EventTarget | null) =>
      target instanceof Node &&
      target !== contentRef() &&
      contentRef()?.contains(target);
    const handleBlur = (event: FocusEvent) => {
      if (isContentControl(event.relatedTarget)) return;
      queueMicrotask(() => {
        // Deferred option registration focuses the menu container. Restore the
        // search field, but never steal a deliberate arrow/click focus on a row.
        if (
          open() &&
          document.activeElement !== input &&
          !isContentControl(document.activeElement)
        )
          input.focus();
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
              onFocusIn={(event) => event.stopPropagation()}
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
            when={!loading() || matches().length > 0}
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
                      closeOnSelect="unless-shift"
                      checked={props
                        .values()
                        .some(
                          (value) =>
                            value.trim().toLowerCase() ===
                            contact.email.toLowerCase()
                        )}
                      onChange={() => toggleEmail(contact.email.toLowerCase())}
                    >
                      <UserIcon
                        id={contact.id}
                        name={contact.name}
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
          <Show
            when={
              source.suggestions.data()?.offline ||
              source.suggestions.data()?.sync === 'partial' ||
              source.suggestions.data()?.sync === 'cold'
            }
          >
            <div role="status" class="px-2 py-1 text-xs text-ink-muted">
              Cached contacts may be incomplete.
            </div>
          </Show>
          <Show when={source.selection.error()}>
            <div role="status" class="px-2 py-1 text-xs text-ink-muted">
              Selected emails are kept; some names are unavailable.
            </div>
          </Show>
          <Show when={source.suggestions.data()?.nextCursor}>
            <Dropdown.Item
              closeOnSelect={false}
              disabled={loading()}
              onSelect={() => {
                source.suggestions.next();
                scrollToTop();
              }}
            >
              Next contacts
            </Dropdown.Item>
          </Show>
          <Show when={canAddEmail()}>
            <Dropdown.Item
              closeOnSelect="unless-shift"
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
          <Show when={!loading() && matches().length === 0 && !canAddEmail()}>
            <div class="px-2 py-3 text-center text-xs text-ink-muted">
              {error()
                ? 'Contacts unavailable. Enter an email instead.'
                : 'No matches on this page or cached snapshot. Enter an email or continue browsing.'}
            </div>
          </Show>
        </Dropdown.Group>
      </Dropdown.SubContent>
    </Dropdown.Sub>
  );
}
