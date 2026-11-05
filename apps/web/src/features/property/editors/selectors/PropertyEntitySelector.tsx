import { t } from '@app/lib/i18n';
import { UserIcon } from '@core/component/UserIcon';
import { isBotPrincipalId } from '@core/constant/macroAgent';
import { useEmail, useUserId } from '@core/context/user';
import { emailToId, useAugmentUserWithDmActivity } from '@core/user';
import type { IUser } from '@core/user/types';
import { fireAndForget } from '@core/util/fireAndForget';
import { createFreshSearch } from '@core/util/freshSort';
import { isEditableInput } from '@core/util/isEditableInput';
import { useKeyPressed } from '@core/util/useKeyPressed';
import { useSelectedFirst } from '@core/util/useSelectedFirst';
import {
  createEmailsInfiniteQuery,
  type EmailEntity,
  Entity,
  type EntityData,
} from '@entity';
import CheckIcon from '@icon/system/regular/check.svg';
import SearchIcon from '@icon/system/regular/magnifying-glass.svg';
import { useSearchInputFocus } from '@property/utils';
import { usePinnedContactUsers } from '@queries/contacts/use-directory';
import { useSearchSoupQuery } from '@queries/soup/search';
import type { EntityType } from '@service-properties/generated/schemas/entityType';
import { debounce } from '@solid-primitives/scheduled';
import { Button, cn } from '@ui';
import * as EmailValidator from 'email-validator';
import {
  createEffect,
  createMemo,
  createSignal,
  For,
  type JSX,
  on,
  onCleanup,
  onMount,
  Show,
} from 'solid-js';
import {
  type CombinedEntity,
  createEntitySearchConfig,
  getEntitySearchText,
  getEntityTimestampedItem,
  getEntityType,
  isChannelEntity,
  quickAccessItemToEntity,
  sortEntitiesWithSelfFirst,
  threadMapper,
  useQuickAccessEntities,
  userToEntity,
} from './entityUtils';
import { OptionCheckBox } from './OptionCheckBox';
import type { EntitySelectorConfig } from './types';

type EntityInputProps = {
  config: EntitySelectorConfig;
  selectedOptions: () => Set<string>;
  setSelectedOptions: (
    options: Set<string>,
    entityInfo?: { id: string; entity_type: EntityType; name: string }[]
  ) => void;
  /** UI-only selection metadata; never added to persisted entity references. */
  onUserSelected?: (user: IUser, custom: boolean) => void;
  onClose?: () => void;
  /** Escape in the search; `onClose` when absent, as a popover saves on close. */
  onCancel?: () => void;
  /** Override empty-result content; null hides the default message. */
  emptyState?: JSX.Element;
};

function getEntityTypePluralLabel(
  entityType: EntityType | EntityType[] | null | undefined
): string {
  if (!entityType || Array.isArray(entityType)) return 'entities';
  switch (entityType) {
    case 'USER':
      return 'users';
    case 'DOCUMENT':
      return 'documents';
    case 'CHANNEL':
      return 'channels';
    case 'PROJECT':
      return 'projects';
    case 'CHAT':
      return 'chats';
    case 'COMPANY':
      return 'companies';
    case 'CONTACT':
      return 'contacts';
    case 'THREAD':
      return 'emails';
    case 'TASK':
      return 'tasks';
    default:
      return 'entities';
  }
}

type UserEntityParts = {
  name: string;
  email?: string;
};

function getUserEntityParts(entity: CombinedEntity): UserEntityParts | null {
  if (entity.kind !== 'user') return null;

  const { name, email } = entity.data;
  if (!name || name === email) return { name: email };
  return { name, email };
}

/** Gets display name for a CombinedEntity */
function getEntityName(entity: CombinedEntity): string {
  if (entity.kind === 'user') {
    return entity.data.name || entity.data.email;
  }

  const data = entity.data;
  if (data.type === 'email') {
    return data.name ?? 'No Subject';
  }
  return data.name ?? '';
}

const MAX_LIST_HEIGHT = 192;

export function PropertyEntitySelector(props: EntityInputProps) {
  const [inputValue, setRawInputValue] = createSignal('');
  const [searchTerm, setSearchTerm] = createSignal('');
  // Personal reads debounce themselves. Their UI must stop offering the old
  // query immediately, particularly when Enter selects a custom address.
  const search = () =>
    props.config.specificEntityType === 'USER'
      ? inputValue().toLowerCase()
      : searchTerm();
  const [selectedIndex, setSelectedIndex] = createSignal(0);
  const openedSelectedIds = [...props.selectedOptions()];
  const setInputValue = (value: string) => {
    setSelectedIndex(0);
    setRawInputValue(value);
  };
  const keyboardMode = useKeyPressed(100);

  let scrollContainerRef: HTMLDivElement | undefined;

  // Debounce search term updates (60ms like MentionsMenu)
  const debouncedSetSearchTerm = debounce(
    (term: string) => setSearchTerm(term.toLowerCase()),
    60
  );
  createEffect(() => debouncedSetSearchTerm(inputValue()));

  let searchInputRef!: HTMLInputElement;

  // Get self-filter context from config
  const selfFilterEntityType = () => props.config.selfFilter?.entityType;
  const selfFilterBlockId = () => props.config.selfFilter?.blockId;

  const augmentUserWithDmActivity = useAugmentUserWithDmActivity();

  // Get current user info for same-domain boost and self-boost in search
  const currentUserEmail = useEmail();
  const currentUserId = useUserId();
  const currentUserDomain = createMemo(() => {
    const email = currentUserEmail();
    return email ? email.split('@')[1] : undefined;
  });

  // Get items from quickAccess based on entity type
  const quickAccess = useQuickAccessEntities(
    () => props.config.specificEntityType,
    search,
    () => !(props.config.specificEntityType === 'USER' && props.config.users),
    () => props.config.excludedIds?.() ?? new Set<string>()
  );
  const quickAccessItems = quickAccess.items;
  const isQuickAccessLoading = quickAccess.isLoading;

  // Fetch emails for browsing (only when THREAD type or generic ENTITY)
  const needsEmailSearch = () =>
    props.config.specificEntityType === 'THREAD' ||
    !props.config.specificEntityType;

  const emailsQuery = createEmailsInfiniteQuery(() => ({ view: 'all' }), {
    disabled: () => !needsEmailSearch(),
  });
  const emails = () => emailsQuery.data ?? [];

  // Server-side email search (query internally disables when < 3 chars)
  const emailSearchQuery = useSearchSoupQuery(
    () => ({
      params: { page_size: 20 },
      body: {
        query: search(),
        match_type: 'partial' as const,
        include: ['emails' as const],
        search_on: 'name' as const,
      },
    }),
    () => ({
      enabled: needsEmailSearch(),
    })
  );

  // Server search results mapped to our format
  const serverEmails = createMemo((): CombinedEntity[] => {
    if (emailSearchQuery.status !== 'success' || !emailSearchQuery.data) {
      return [];
    }
    return emailSearchQuery.data
      .filter((entity) => entity.type === 'email')
      .map((entity) => threadMapper(entity as EmailEntity));
  });

  const isLoadingEntities = createMemo(() => {
    if (props.config.users) return false;
    if (needsEmailSearch()) {
      return (
        emailsQuery.isLoading ||
        emailsQuery.isPending ||
        emailSearchQuery.isFetching
      );
    }
    return isQuickAccessLoading();
  });

  // An explicit user pool replaces Quick Access options.
  const scopedUserEntities = createMemo(() => {
    if (props.config.specificEntityType !== 'USER' || !props.config.users) {
      return undefined;
    }
    return [
      ...props.config.users(),
      ...(props.config.additionalUsers?.() ?? []),
    ].map((user) => userToEntity(augmentUserWithDmActivity(user)));
  });

  const pinnedUsers = usePinnedContactUsers(
    props.selectedOptions,
    () =>
      (!props.config.specificEntityType ||
        props.config.specificEntityType === 'USER') &&
      !props.config.users
  );

  // Convert quickAccess items to CombinedEntity format.
  const entities = createMemo((): CombinedEntity[] => {
    const scoped = scopedUserEntities();
    if (scoped) return scoped;
    const specificEntityType = props.config.specificEntityType;

    // For THREAD type, use email data (not in quickAccess yet)
    if (specificEntityType === 'THREAD') {
      return emails().map(threadMapper);
    }

    // Convert quickAccess items to CombinedEntity
    const items = quickAccessItems();
    const additionalUsers = [
      ...new Map(
        [
          ...(specificEntityType === 'USER'
            ? (props.config.additionalUsers?.() ?? [])
            : []),
          ...pinnedUsers(),
        ].map((user) => [user.id, user])
      ).values(),
    ];
    const converted: CombinedEntity[] = additionalUsers.map(userToEntity);
    const additionalIds = new Set(additionalUsers.map((user) => user.id));

    for (const item of items) {
      if (additionalIds.has(item.id)) continue;
      // Augment users with DM activity
      if (item.kind === 'user') {
        const augmentedUser = augmentUserWithDmActivity(item.data);
        converted.push(userToEntity(augmentedUser));
      } else {
        const entity = quickAccessItemToEntity(item);
        const entityType = getEntityType(entity);
        const matches =
          !specificEntityType ||
          (Array.isArray(specificEntityType)
            ? entityType && specificEntityType.includes(entityType)
            : entityType === specificEntityType);
        if (entityType && matches) {
          converted.push(entity);
        }
      }
    }

    // For generic entity type, also include emails
    if (!specificEntityType) {
      converted.push(...emails().map(threadMapper));
    }

    return converted;
  });

  const customEmail = createMemo(() => {
    if (!props.config.allowCustomEmail) return undefined;
    const raw = inputValue().trim();
    if (!EmailValidator.validate(raw)) return undefined;
    const lower = raw.toLowerCase();
    const alreadyListed = entities().some(
      (entity) =>
        entity.kind === 'user' && entity.data.email.toLowerCase() === lower
    );
    if (alreadyListed) return undefined;
    return raw;
  });

  const customEmailEntity = (): CombinedEntity | undefined => {
    const email = customEmail();
    if (!email) return undefined;
    return userToEntity({ id: emailToId(email), email, name: email });
  };

  const entitySearch = createFreshSearch<CombinedEntity>({
    config: createEntitySearchConfig(currentUserDomain, currentUserId),
    getName: getEntitySearchText,
    isChannelItem: isChannelEntity,
    getTimestamp: getEntityTimestampedItem,
  });

  const filteredEntities = createMemo(() => {
    const term = search();
    const excludedIds = props.config.excludedIds?.();
    const allEntities = entities().filter(
      (entity) => !excludedIds?.has(entity.id)
    );
    const userId = currentUserId();

    // List is unvirtualized — revisit if these caps grow significantly.
    const MAX_VISIBLE_ENTITIES_NO_SEARCH = 50;
    const MAX_SEARCH_RESULTS = 20;

    // Filter out the current entity when selecting same entity type
    const blockId = selfFilterBlockId();
    const currentEntityType = selfFilterEntityType();
    const excludeFilter = blockId
      ? (e: CombinedEntity) =>
          !(getEntityType(e) === currentEntityType && e.id === blockId)
      : () => true;

    const address = inputValue().trim();
    if (props.config.allowCustomEmail && EmailValidator.validate(address)) {
      // A complete address is an identity, not a display-name alias. It must
      // never redirect a calendar invitation to another person's mailbox.
      return allEntities
        .filter(excludeFilter)
        .filter(
          (entity) =>
            entity.kind === 'user' &&
            entity.data.email.toLowerCase() === address.toLowerCase()
        );
    }

    if (props.config.specificEntityType === 'USER' && !props.config.users) {
      const eligible = allEntities.filter(excludeFilter);
      if (!term) return sortEntitiesWithSelfFirst(eligible, userId);
      const matched = entitySearch(eligible, term).map((result) => result.item);
      const found = new Set(matched.map((entity) => entity.id));
      const page = new Set(quickAccessItems().map((item) => item.id));
      // A person page is already bounded. Do not discard its tail behind a
      // second cap, or drop broader native/server matches in a local matcher.
      return [
        ...matched,
        ...eligible.filter(
          (entity) => page.has(entity.id) && !found.has(entity.id)
        ),
      ];
    }

    // Get visible entities based on search
    // Sort self to top BEFORE slicing to ensure self appears even if not in top 50 by default
    let localResults: CombinedEntity[];
    if (term) {
      localResults = entitySearch(allEntities, term)
        .slice(0, MAX_SEARCH_RESULTS)
        .map((result) => result.item)
        .filter(excludeFilter);
    } else {
      localResults = sortEntitiesWithSelfFirst(
        allEntities.filter(excludeFilter),
        userId
      ).slice(0, MAX_VISIBLE_ENTITIES_NO_SEARCH);
    }

    // For THREAD or generic entity: merge local + server results
    if (needsEmailSearch() && term) {
      const localIds = new Set(localResults.map((e) => e.id));
      const serverResults = serverEmails()
        .filter((entity) => !excludedIds?.has(entity.id))
        .filter((e) => !localIds.has(e.id))
        .filter(excludeFilter);
      return [...localResults, ...serverResults].slice(0, MAX_SEARCH_RESULTS);
    }

    return localResults;
  });

  // Sort entities with selected items first when not searching. Self is
  // already pinned to the top within `filteredEntities`; this layers
  // selected-first on top of that ordering.
  const sortedEntities = useSelectedFirst({
    items: filteredEntities,
    allItems: entities,
    selectedIds: () => openedSelectedIds,
    searchQuery: search,
    getId: (e: CombinedEntity) => e.id,
  });

  const toggleEntity = (entity: CombinedEntity, custom = false) => {
    const entityType = getEntityType(entity);
    if (!entityType) return;
    const newSelected = new Set(props.selectedOptions());
    const isCurrentlySelected = newSelected.has(entity.id);

    if (props.config.isMultiSelect) {
      if (isCurrentlySelected) {
        newSelected.delete(entity.id);
      } else {
        newSelected.add(entity.id);
      }
    } else {
      newSelected.clear();
      if (!isCurrentlySelected) newSelected.add(entity.id);
    }

    if (!isCurrentlySelected && entity.kind === 'user') {
      props.onUserSelected?.(
        {
          id: entity.data.id,
          email: entity.data.email,
          name: entity.data.name,
        },
        custom
      );
    }
    props.setSelectedOptions(newSelected, [
      {
        id: entity.id,
        entity_type: entityType,
        name: getEntityName(entity),
      },
    ]);

    if (!props.config.isMultiSelect && props.onClose) {
      props.onClose();
    } else if (props.config.isMultiSelect && searchInputRef) {
      setInputValue('');
      setSearchTerm('');
      setTimeout(() => searchInputRef.focus(), 0);
    }
  };

  const resultCount = () => sortedEntities().length + (customEmail() ? 1 : 0);

  createEffect(() => {
    search();
    resultCount();
    setSelectedIndex(0);
  });
  let previousWindow: string | undefined;
  createEffect(
    on(quickAccess.windowKey, (key) => {
      if (!key) return;
      if (previousWindow && key !== previousWindow) {
        setSelectedIndex(0);
        if (scrollContainerRef) scrollContainerRef.scrollTop = 0;
      }
      previousWindow = key;
    })
  );
  const loadNext = () =>
    fireAndForget(quickAccess.loadMore(), 'property-picker');

  // Scroll the selected row into view during keyboard navigation
  createEffect(() => {
    const index = selectedIndex();
    if (!keyboardMode() || !scrollContainerRef) return;
    const row = scrollContainerRef.querySelector<HTMLDivElement>(
      `[data-entity-index="${index}"]`
    );
    row?.scrollIntoView({ block: 'nearest' });
  });

  const handleKeyDown = (e: KeyboardEvent) => {
    if (
      e.defaultPrevented ||
      (e.target instanceof HTMLElement && e.target.closest('button'))
    )
      return;
    // Another field on the page keeps its own keys.
    if (
      e.target !== searchInputRef &&
      e.target instanceof Element &&
      isEditableInput(e.target)
    )
      return;
    if (e.key === 'PageDown' && quickAccess.hasMore()) {
      e.preventDefault();
      if (!quickAccess.isLoadingMore()) loadNext();
      return;
    }
    const total = resultCount();
    if (total === 0) return;

    if (e.key === 'ArrowDown' || (e.ctrlKey && e.key === 'j')) {
      e.preventDefault();
      setSelectedIndex((prev) => (Math.min(prev, total - 1) + 1) % total);
    } else if (e.key === 'ArrowUp' || (e.ctrlKey && e.key === 'k')) {
      e.preventDefault();
      setSelectedIndex(
        (prev) => (Math.min(prev, total - 1) - 1 + total) % total
      );
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const idx = Math.min(selectedIndex(), total - 1);
      if (idx < sortedEntities().length) {
        const entity = sortedEntities()[idx];
        if (entity) toggleEntity(entity);
      } else {
        const entity = customEmailEntity();
        if (entity) toggleEntity(entity, true);
      }
    }
  };

  onMount(() => {
    document.addEventListener('keydown', handleKeyDown);
  });

  onCleanup(() => {
    document.removeEventListener('keydown', handleKeyDown);
  });

  useSearchInputFocus(() => searchInputRef);

  const fills = () => props.config.fillHeight === true;
  const keepSearchFocus = (event: Event) => event.preventDefault();

  const selectedEntityCountAtOpen = createMemo(() => {
    if (!props.config.isMultiSelect || searchTerm()) return 0;

    return sortedEntities().filter((entity) =>
      openedSelectedIds.includes(entity.id)
    ).length;
  });
  const shouldShowSelectedDivider = (index: number) => {
    const selectedCount = selectedEntityCountAtOpen();
    if (selectedCount === 0) return false;
    if (selectedCount === sortedEntities().length) return false;

    return index === selectedCount;
  };

  return (
    <div class={cn(fills() && 'flex min-h-0 flex-1 flex-col')}>
      <div class="relative shrink-0">
        <div class="flex w-full items-center py-2 gap-2 px-2 border-b border-edge-muted">
          <SearchIcon class="size-4 text-ink-muted" />
          <input
            class="w-full caret-accent"
            ref={searchInputRef}
            type="text"
            value={inputValue()}
            onInput={(e) => setInputValue(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                e.preventDefault();
                e.stopPropagation();
                (props.onCancel ?? props.onClose)?.();
              }
            }}
            placeholder={props.config.placeholder}
          />
        </div>
      </div>
      <Show when={resultCount() > 0}>
        {/* Picking a row keeps focus in the search field: a tap that moved
          it would drop the phone keyboard until the refocus below. iOS
          devices still send mousedown after a cancelled pointerdown. */}
        <div
          class={cn('p-1.5', fills() && 'flex min-h-0 flex-1 flex-col')}
          onPointerDown={keepSearchFocus}
          onMouseDown={keepSearchFocus}
        >
          <Show when={sortedEntities().length > 0}>
            <div
              ref={scrollContainerRef}
              style={{
                'max-height': fills() ? undefined : `${MAX_LIST_HEIGHT}px`,
              }}
              class={cn(
                'overflow-y-auto overflow-x-hidden scrollbar-hidden',
                fills() && 'min-h-0 flex-1'
              )}
            >
              <For each={sortedEntities()}>
                {(entity, index) => {
                  const isSelected = () =>
                    props.selectedOptions().has(entity.id);
                  const isKeyboardSelected = () => index() === selectedIndex();

                  return (
                    <>
                      <Show when={shouldShowSelectedDivider(index())}>
                        <div class="my-1 border-t border-edge-muted" />
                      </Show>
                      <div
                        data-entity-index={index()}
                        class="group rounded-lg w-full flex items-center justify-between gap-1.5 p-1.5 px-2 text-left text-ink font-normal cursor-default min-w-0 touch:min-h-12"
                        classList={{
                          'bg-hover': isKeyboardSelected(),
                        }}
                        onClick={() => toggleEntity(entity)}
                        onKeyDown={(e) =>
                          e.key === 'Enter' && toggleEntity(entity)
                        }
                        onMouseEnter={() => {
                          if (!keyboardMode()) {
                            setSelectedIndex(index());
                          }
                        }}
                      >
                        <Show when={props.config.isMultiSelect}>
                          <div class="shrink-0 flex">
                            <OptionCheckBox
                              checked={isSelected()}
                              multiselect
                              visible={props.config.visibleCheckboxes}
                            />
                          </div>
                        </Show>
                        <div class="flex items-center gap-2 flex-1 min-w-0">
                          <div class="size-4 shrink-0 flex items-center">
                            <Show
                              when={entity.kind === 'entity'}
                              fallback={
                                <UserIcon
                                  id={entity.id}
                                  name={
                                    entity.kind === 'user'
                                      ? entity.data.name
                                      : undefined
                                  }
                                  size="sm"
                                  isDeleted={false}
                                  suppressClick={true}
                                  photoUrl={
                                    entity.kind === 'user'
                                      ? entity.data.photoUrl
                                      : undefined
                                  }
                                />
                              }
                            >
                              <Entity.Icon entity={entity.data as EntityData} />
                            </Show>
                          </div>
                          <span class="truncate min-w-0 max-w-full">
                            <Show
                              when={entity.kind === 'entity'}
                              fallback={
                                <Show
                                  when={getUserEntityParts(entity)}
                                  fallback={getEntityName(entity)}
                                >
                                  {(parts) => (
                                    <>
                                      {parts().name}
                                      <Show when={parts().email}>
                                        {/* An en space is the 0.5em gap; unlike a margin, Safari's truncated-text tooltip keeps it. */}
                                        {' '}
                                        <span class="opacity-50">
                                          {parts().email}
                                        </span>
                                      </Show>
                                    </>
                                  )}
                                </Show>
                              }
                            >
                              <Entity.Title
                                entity={entity.data as EntityData}
                              />
                            </Show>
                          </span>
                          <Show when={isBotPrincipalId(entity.id)}>
                            <span class="shrink-0 text-xs text-ink-muted">
                              Agent
                            </span>
                          </Show>
                        </div>
                        <Show
                          when={!props.config.isMultiSelect && isSelected()}
                        >
                          <CheckIcon class="size-3.5 shrink-0 text-accent" />
                        </Show>
                      </div>
                    </>
                  );
                }}
              </For>
            </div>
          </Show>
          <Show when={customEmail()}>
            {(email) => {
              const rowIndex = () => sortedEntities().length;
              const entity = () => customEmailEntity();
              return (
                <div
                  class="group rounded-lg w-full flex items-center justify-between gap-1.5 p-1.5 px-2 text-left text-ink font-normal cursor-default min-w-0 touch:min-h-12"
                  classList={{
                    'bg-hover': rowIndex() === selectedIndex(),
                  }}
                  onClick={() => {
                    const next = entity();
                    if (next) toggleEntity(next, true);
                  }}
                  onMouseEnter={() => {
                    if (!keyboardMode()) setSelectedIndex(rowIndex());
                  }}
                >
                  <Show when={props.config.isMultiSelect}>
                    <div class="shrink-0">
                      <OptionCheckBox checked={false} multiselect />
                    </div>
                  </Show>
                  <div class="flex items-center gap-2 flex-1 min-w-0">
                    <div class="size-4 shrink-0 flex items-center">
                      <UserIcon
                        id={emailToId(email())}
                        name={email()}
                        size="sm"
                        isDeleted={false}
                        suppressClick={true}
                      />
                    </div>
                    <span class="truncate min-w-0">Add {email()}</span>
                  </div>
                </div>
              );
            }}
          </Show>
        </div>
      </Show>

      <Show when={quickAccess.error()}>
        <div role="status" class="px-2 py-2 text-xs text-ink-muted">
          {t('common.optionsUnavailable')}
        </div>
      </Show>
      <Show when={resultCount() === 0 && !quickAccess.error()}>
        {props.emptyState !== undefined ? (
          props.emptyState
        ) : (
          <div class="text-center py-4 text-ink-muted text-sm">
            <Show
              when={!isLoadingEntities()}
              fallback={<span>Loading...</span>}
            >
              {props.config.emptyMessage ??
                `No ${getEntityTypePluralLabel(props.config.specificEntityType)} found`}
            </Show>
          </div>
        )}
      </Show>
      <Show when={quickAccess.hasMore()}>
        <Button
          variant="ghost"
          class="w-full"
          disabled={quickAccess.isLoadingMore()}
          onPointerDown={(event) => event.preventDefault()}
          onClick={loadNext}
        >
          {t('viewMenus.nextOptions')}
        </Button>
      </Show>
    </div>
  );
}
