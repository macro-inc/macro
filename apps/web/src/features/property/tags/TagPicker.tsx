import { Popover } from '@kobalte/core/popover';
import PencilSimple from '@phosphor/pencil-simple.svg';
import Trash from '@phosphor/trash.svg';
import { OptionCheckBox } from '@property/editors/selectors/OptionCheckBox';
import {
  DropdownSearchInput,
  DropdownSelectableRow,
  useDropdownSearch,
} from '@property/editors/selectors/PropertyOptionSelector';
import { useAddPropertyOptionMutation } from '@queries/properties/options';
import {
  invalidateTags,
  useDeletePropertyOptionMutation,
  useEnsureTagSetMutation,
  useUpdatePropertyOptionMutation,
} from '@queries/properties/tags';
import type { PropertyOptionResponse } from '@service-properties/generated/schemas/propertyOptionResponse';
import type { TagScope } from '@service-properties/generated/schemas/tagScope';
import { Button, cn, Dialog, Layer } from '@ui';
import {
  createMemo,
  createSignal,
  For,
  type JSX,
  Match,
  onCleanup,
  onMount,
  Show,
  Switch,
} from 'solid-js';
import { TagDot } from './TagDot';
import { DEFAULT_TAG_COLOR, TAG_COLORS } from './tagColors';
import type { ResolvedTag, useDocTags } from './useDocTags';

type DocTags = ReturnType<typeof useDocTags>;
type TagOptionItem = {
  type: 'option';
  scope: TagScope;
  option: PropertyOptionResponse;
};
type TagSelectableItem = TagOptionItem | { type: 'add' };

function optionLabel(option: PropertyOptionResponse): string {
  return option.value.type === 'string' ? option.value.value : '';
}

function nextDisplayOrder(options: PropertyOptionResponse[]): number {
  return (
    options.reduce((max, option) => Math.max(max, option.displayOrder), -1) + 1
  );
}

// Bring a newly expanded row fully into view once it mounts so the bottom
// row's action buttons are never clipped below the scroll viewport. Deferred a
// frame so it runs after the expanded layout settles.
function scrollExpandedRowIntoView(el: HTMLElement) {
  requestAnimationFrame(() => el.scrollIntoView({ block: 'nearest' }));
}

function focusWithoutScroll(el: HTMLInputElement) {
  requestAnimationFrame(() => el.focus({ preventScroll: true }));
}

const SCOPE_LABEL: Record<TagScope, string> = {
  user: 'My tags',
  team: 'Team tags',
};

export function TagPicker(props: {
  docTags: DocTags;
  replaceTag?: ResolvedTag;
  triggerClass?: string;
  triggerLabel: string;
  children: JSX.Element;
  onOpenChange?: (open: boolean) => void;
}) {
  const [open, setOpen] = createSignal(false);
  let saveAndClose: (() => void) | undefined;

  const setOpenState = (value: boolean) => {
    setOpen(value);
    props.onOpenChange?.(value);
  };

  const handleOpenChange = (value: boolean) => {
    if (value) {
      setOpenState(true);
      return;
    }
    saveAndClose?.();
    setOpenState(false);
  };

  return (
    <Popover
      open={open()}
      onOpenChange={handleOpenChange}
      placement="bottom-start"
      gutter={4}
    >
      <Popover.Trigger
        type="button"
        class={props.triggerClass}
        aria-label={props.triggerLabel}
      >
        {props.children}
      </Popover.Trigger>
      <Show when={open()}>
        <SimpleTagPickerBody
          docTags={props.docTags}
          onClose={() => setOpenState(false)}
          registerSave={(handler) => {
            saveAndClose = handler;
          }}
        />
      </Show>
    </Popover>
  );
}

/**
 * Trigger-less TagPicker anchored at an arbitrary point, for callers that
 * open the picker from somewhere else (e.g. a context-menu action).
 */
export function TagPickerPopover(props: {
  docTags: DocTags;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  getAnchorRect: () => { x: number; y: number } | undefined;
}) {
  let saveAndClose: (() => void) | undefined;
  const handleOpenChange = (value: boolean) => {
    if (value) {
      props.onOpenChange(true);
      return;
    }
    saveAndClose?.();
    props.onOpenChange(false);
  };

  return (
    <Popover
      open={props.open}
      onOpenChange={handleOpenChange}
      getAnchorRect={props.getAnchorRect}
      placement="bottom-start"
      gutter={4}
    >
      <Show when={props.open}>
        <SimpleTagPickerBody
          docTags={props.docTags}
          onClose={() => props.onOpenChange(false)}
          registerSave={(handler) => {
            saveAndClose = handler;
          }}
        />
      </Show>
    </Popover>
  );
}

function SimpleTagPickerBody(props: {
  docTags: DocTags;
  onClose: () => void;
  registerSave: (handler: (() => void) | undefined) => void;
}) {
  const [search, setSearch] = createSignal('');
  const [createScope, setCreateScope] = createSignal<TagScope>('user');
  const [createColor, setCreateColor] = createSignal<string>(DEFAULT_TAG_COLOR);
  const [saved, setSaved] = createSignal(false);
  const [selectedIds, setSelectedIds] = createSignal<Set<string>>(
    new Set(props.docTags.appliedTags().map((tag) => tag.optionId))
  );
  const [createdOptionScopes, setCreatedOptionScopes] = createSignal<
    Map<string, TagScope>
  >(new Map());

  const addOption = useAddPropertyOptionMutation();
  const ensureTagSet = useEnsureTagSetMutation();

  const initialAppliedTags = props.docTags.appliedTags();
  const initialAppliedIds = new Set(
    initialAppliedTags.map((tag) => tag.optionId)
  );
  const initialOptionScopes = new Map<string, TagScope>();
  const initialOptionsById = new Map<string, PropertyOptionResponse>();
  for (const set of props.docTags.tagSets()) {
    for (const option of set.options) {
      initialOptionScopes.set(option.id, set.scope);
      initialOptionsById.set(option.id, option);
    }
  }
  const initialAppliedItems: TagOptionItem[] = initialAppliedTags.flatMap(
    (tag) => {
      const option = initialOptionsById.get(tag.optionId);
      return option
        ? [{ type: 'option' as const, scope: tag.scope, option }]
        : [];
    }
  );
  const initialItems: TagOptionItem[] = props.docTags.tagSets().flatMap((set) =>
    [...set.options]
      .sort((a, b) => a.displayOrder - b.displayOrder)
      .map((option) => ({
        type: 'option' as const,
        scope: set.scope,
        option,
      }))
  );

  const query = () => search().trim().toLowerCase();
  const matchesSearch = (option: PropertyOptionResponse) =>
    !query() || optionLabel(option).toLowerCase().includes(query());

  const visibleItems = createMemo(() =>
    initialItems.filter((item) => matchesSearch(item.option))
  );
  const initiallySelectedVisibleItems = createMemo(() =>
    initialAppliedItems.filter((item) => matchesSearch(item.option))
  );
  const initiallyUnselectedVisibleItems = createMemo(() =>
    visibleItems().filter((item) => !initialAppliedIds.has(item.option.id))
  );
  const hasTeamSet = () =>
    props.docTags.tagSets().some((set) => set.scope === 'team');

  const exactMatchExists = createMemo(() => {
    const q = query();
    if (!q) return false;
    return props.docTags
      .tagSets()
      .some((set) =>
        set.options.some((option) => optionLabel(option).toLowerCase() === q)
      );
  });

  const showCreateRow = () => !!search().trim() && !exactMatchExists();
  const selectableItems = createMemo<TagSelectableItem[]>(() => [
    ...initiallySelectedVisibleItems(),
    ...initiallyUnselectedVisibleItems(),
    ...(showCreateRow() ? ([{ type: 'add' }] as const) : []),
  ]);

  const optionIndex = (optionId: string) =>
    selectableItems().findIndex(
      (item) => item.type === 'option' && item.option.id === optionId
    );

  const isSelected = (optionId: string) => selectedIds().has(optionId);
  const toggleSelected = (optionId: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(optionId)) next.delete(optionId);
      else next.add(optionId);
      return next;
    });
  };

  const optionScope = (optionId: string): TagScope | undefined =>
    createdOptionScopes().get(optionId) ?? initialOptionScopes.get(optionId);

  const handleCreate = async () => {
    const value = search().trim();
    if (!value || exactMatchExists()) return;
    const scope = createScope();
    const provisioned = await ensureTagSet.mutateAsync({ scope });
    if (!provisioned.definition) return;
    const created = await addOption.mutateAsync({
      propertyDefinitionId: provisioned.definition.id,
      body: {
        type: 'select_string',
        option: {
          value,
          display_order: nextDisplayOrder(provisioned.options),
          color: createColor(),
        },
      },
    });
    invalidateTags();
    setCreatedOptionScopes((prev) => new Map(prev).set(created.id, scope));
    setSelectedIds((prev) => new Set(prev).add(created.id));
    setSearch('');
  };

  const save = () => {
    if (saved()) return;
    setSaved(true);
    const nextSelectedIds = selectedIds();
    void (async () => {
      for (const tag of initialAppliedTags) {
        if (!nextSelectedIds.has(tag.optionId)) {
          await props.docTags.removeTag(tag.scope, tag.optionId);
        }
      }
      for (const optionId of nextSelectedIds) {
        if (initialAppliedIds.has(optionId)) continue;
        const scope = optionScope(optionId);
        if (scope) await props.docTags.applyTag(scope, optionId);
      }
    })();
  };

  const saveAndClose = () => {
    save();
    props.onClose();
  };

  const dropdown = useDropdownSearch({
    itemCount: () => selectableItems().length,
    onSelect: (index, event) => {
      const item = selectableItems()[index];
      if (!item) return;
      if (item.type === 'add') {
        void (async () => {
          await handleCreate();
          if (!event?.shiftKey) saveAndClose();
        })();
      } else {
        toggleSelected(item.option.id);
        if (!event?.shiftKey) saveAndClose();
      }
    },
    onClose: saveAndClose,
    enableNumericHotkeys: false,
  });

  const handleKeyDown = (event: KeyboardEvent) => {
    if (saved()) return;
    dropdown.handleKeyDown(event);
  };

  onMount(() => {
    props.registerSave(saveAndClose);
    document.addEventListener('keydown', handleKeyDown);
  });

  onCleanup(() => {
    props.registerSave(undefined);
    document.removeEventListener('keydown', handleKeyDown);
  });

  const row = (item: TagOptionItem) => (
    <TagPickerSimpleRow
      item={item}
      checked={isSelected(item.option.id)}
      selected={dropdown.selectedIndex() === optionIndex(item.option.id)}
      onSelect={(event) => {
        toggleSelected(item.option.id);
        if (!event.shiftKey) saveAndClose();
      }}
      onMouseEnter={() => {
        if (!dropdown.keyboardMode()) {
          dropdown.setSelectedIndex(optionIndex(item.option.id));
        }
      }}
    />
  );

  return (
    <Popover.Portal>
      <Layer depth={3}>
        <Popover.Content
          class="z-modal w-64 rounded-xl bg-surface text-sm shadow-menu ring ring-edge-muted menu-open-animation"
          onCloseAutoFocus={(event) => event.preventDefault()}
        >
          <DropdownSearchInput
            value={search()}
            placeholder="Change or select tags..."
            onInput={(value) => {
              setSearch(value);
              dropdown.setSearchQuery(value);
            }}
          />
          <div class="max-h-72 scroll-pb-1.5 overflow-y-auto p-1.5">
            <For each={initiallySelectedVisibleItems()}>{row}</For>
            <Show
              when={
                initiallySelectedVisibleItems().length > 0 &&
                initiallyUnselectedVisibleItems().length > 0
              }
            >
              <div class="my-1 border-t border-edge-muted" />
            </Show>
            <For each={initiallyUnselectedVisibleItems()}>{row}</For>
            <Show when={showCreateRow()}>
              <CreateRow
                label={search().trim()}
                scope={createScope()}
                color={createColor()}
                hasTeamSet={hasTeamSet()}
                pending={addOption.isPending || ensureTagSet.isPending}
                onScope={setCreateScope}
                onColor={setCreateColor}
                onCreate={handleCreate}
                onCancel={() => setSearch('')}
                selected={
                  dropdown.selectedIndex() === selectableItems().length - 1
                }
                onMouseEnter={() => {
                  if (!dropdown.keyboardMode()) {
                    dropdown.setSelectedIndex(selectableItems().length - 1);
                  }
                }}
              />
            </Show>
          </div>
        </Popover.Content>
      </Layer>
    </Popover.Portal>
  );
}

function TagPickerSimpleRow(props: {
  item: TagOptionItem;
  checked: boolean;
  selected: boolean;
  onSelect: (event: MouseEvent) => void;
  onMouseEnter: () => void;
}) {
  return (
    <DropdownSelectableRow
      isSelected={props.selected}
      onClick={props.onSelect}
      onMouseEnter={props.onMouseEnter}
    >
      <OptionCheckBox checked={props.checked} multiselect />
      <TagDot color={props.item.option.color ?? undefined} />
      <span class="min-w-0 flex-1 truncate">
        {optionLabel(props.item.option)}
      </span>
    </DropdownSelectableRow>
  );
}

function _TagPickerBody(props: {
  docTags: DocTags;
  replaceTag?: ResolvedTag;
  onClose: () => void;
  registerRequestClose: (handler: (() => void) | undefined) => void;
  dismissOnFocusOutside?: boolean;
}) {
  const [search, setSearch] = createSignal('');
  const [createScope, setCreateScope] = createSignal<TagScope>('user');
  const [createColor, setCreateColor] = createSignal<string>(DEFAULT_TAG_COLOR);
  const [editingId, setEditingId] = createSignal<string | null>(null);
  const [closed, setClosed] = createSignal(false);
  const initialAppliedIds = new Set(
    props.docTags.appliedTags().map((tag) => tag.optionId)
  );
  const initialOptionScopes = new Map<string, TagScope>();
  const initialOptionsById = new Map<string, PropertyOptionResponse>();
  for (const set of props.docTags.tagSets()) {
    for (const option of set.options) {
      initialOptionScopes.set(option.id, set.scope);
      initialOptionsById.set(option.id, option);
    }
  }
  const initialAppliedItems: TagOptionItem[] = [];
  for (const tag of props.docTags.appliedTags()) {
    const option = initialOptionsById.get(tag.optionId);
    if (option) {
      initialAppliedItems.push({ type: 'option', scope: tag.scope, option });
    }
  }
  const initialRemainingItems: TagOptionItem[] = [];
  for (const set of props.docTags.tagSets()) {
    for (const option of [...set.options].sort(
      (a, b) => a.displayOrder - b.displayOrder
    )) {
      if (initialAppliedIds.has(option.id)) continue;
      initialRemainingItems.push({ type: 'option', scope: set.scope, option });
    }
  }
  const [selectedIds, setSelectedIds] = createSignal<Set<string>>(
    new Set(initialAppliedIds)
  );
  const [createdOptionScopes, setCreatedOptionScopes] = createSignal<
    Map<string, TagScope>
  >(new Map());

  const addOption = useAddPropertyOptionMutation();
  const ensureTagSet = useEnsureTagSetMutation();

  const hasTeamSet = createMemo(() =>
    props.docTags.tagSets().some((set) => set.scope === 'team')
  );

  const isSelected = (optionId: string) => selectedIds().has(optionId);

  const toggleSelected = (optionId: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(optionId)) next.delete(optionId);
      else next.add(optionId);
      return next;
    });
  };

  const query = () => search().trim().toLowerCase();

  const exactMatchExists = createMemo(() => {
    const q = search().trim().toLowerCase();
    if (!q) return false;
    return props.docTags
      .tagSets()
      .some((set) =>
        set.options.some((option) => optionLabel(option).toLowerCase() === q)
      );
  });

  const matchesSearch = (option: PropertyOptionResponse) =>
    !query() || optionLabel(option).toLowerCase().includes(query());

  const appliedTagOptions = createMemo<TagOptionItem[]>(() =>
    initialAppliedItems.filter((item) => matchesSearch(item.option))
  );

  const remainingTagOptions = createMemo<TagOptionItem[]>(() =>
    initialRemainingItems.filter((item) => matchesSearch(item.option))
  );

  const remainingTagOptionsForScope = (scope: TagScope) =>
    remainingTagOptions().filter((item) => item.scope === scope);

  const selectableTagOptions = createMemo<TagSelectableItem[]>(() => [
    ...appliedTagOptions(),
    ...remainingTagOptions(),
  ]);

  const showCreateRow = () => !!search().trim() && !exactMatchExists();

  const selectableItems = createMemo<TagSelectableItem[]>(() => [
    ...selectableTagOptions(),
    ...(showCreateRow() ? ([{ type: 'add' }] as const) : []),
  ]);

  const optionIndex = (optionId: string) =>
    selectableItems().findIndex(
      (item) => item.type === 'option' && item.option.id === optionId
    );

  const optionScope = (optionId: string): TagScope | undefined => {
    const createdScope = createdOptionScopes().get(optionId);
    if (createdScope) return createdScope;
    const initialScope = initialOptionScopes.get(optionId);
    if (initialScope) return initialScope;
    for (const set of props.docTags.tagSets()) {
      if (set.options.some((option) => option.id === optionId)) {
        return set.scope;
      }
    }
    return undefined;
  };

  const handleCreate = async () => {
    const value = search().trim();
    if (!value || exactMatchExists()) return;
    const scope = createScope();
    const provisioned = await ensureTagSet.mutateAsync({ scope });
    if (!provisioned.definition) return;
    const created = await addOption.mutateAsync({
      propertyDefinitionId: provisioned.definition.id,
      body: {
        type: 'select_string',
        option: {
          value,
          display_order: nextDisplayOrder(provisioned.options),
          color: createColor(),
        },
      },
    });
    invalidateTags();
    setCreatedOptionScopes((prev) => {
      const next = new Map(prev);
      next.set(created.id, scope);
      return next;
    });
    setSelectedIds((prev) => new Set(prev).add(created.id));
    setPickerSearch('');
  };

  const selectTag = (_scope: TagScope, option: PropertyOptionResponse) => {
    toggleSelected(option.id);
  };

  const handleSelectableItem = (index: number) => {
    const item = selectableItems()[index];
    if (!item) return;
    if (item.type === 'add') {
      void handleCreate();
      return;
    }
    selectTag(item.scope, item.option);
  };

  const dropdown = useDropdownSearch({
    itemCount: () => selectableItems().length,
    onSelect: handleSelectableItem,
    onClose: () => {
      void closePicker();
    },
    enableNumericHotkeys: false,
  });

  const setPickerSearch = (value: string) => {
    setSearch(value);
    dropdown.setSearchQuery(value);
  };

  const closePicker = async () => {
    if (closed()) return;
    setClosed(true);

    const applied = props.docTags.appliedTags();
    const appliedIds = new Set(applied.map((tag) => tag.optionId));
    const nextSelectedIds = selectedIds();

    try {
      for (const tag of applied) {
        if (!nextSelectedIds.has(tag.optionId)) {
          await props.docTags.removeTag(tag.scope, tag.optionId);
        }
      }

      for (const optionId of nextSelectedIds) {
        if (appliedIds.has(optionId)) continue;
        const scope = optionScope(optionId);
        if (scope) await props.docTags.applyTag(scope, optionId);
      }
    } finally {
      setPickerSearch('');
      setEditingId(null);
      props.onClose();
    }
  };

  const handleKeyDown = (event: KeyboardEvent) => {
    if (editingId()) return;
    dropdown.handleKeyDown(event);
  };

  onMount(() => {
    props.registerRequestClose(() => {
      void closePicker();
    });
    document.addEventListener('keydown', handleKeyDown);
  });

  onCleanup(() => {
    props.registerRequestClose(undefined);
    document.removeEventListener('keydown', handleKeyDown);
  });

  return (
    <Popover.Portal>
      <Layer depth={3}>
        <Popover.Content
          class="z-modal w-64 rounded-xl bg-surface text-sm shadow-menu ring ring-edge-muted menu-open-animation"
          onCloseAutoFocus={(event) => event.preventDefault()}
          onFocusOutside={(event) => {
            if (props.dismissOnFocusOutside === false) event.preventDefault();
          }}
          onInteractOutside={(event) => {
            event.preventDefault();
            void closePicker();
          }}
          onEscapeKeyDown={(event) => {
            event.preventDefault();
            void closePicker();
          }}
        >
          <DropdownSearchInput
            value={search()}
            placeholder="Change or select tags..."
            onInput={setPickerSearch}
          />

          <div class="max-h-72 scroll-pb-1.5 overflow-y-auto p-1.5">
            <Show when={appliedTagOptions().length > 0}>
              <For each={appliedTagOptions()}>
                {(item) => (
                  <TagPickerRow
                    scope={item.scope}
                    option={item.option}
                    docTags={props.docTags}
                    replaceTag={props.replaceTag}
                    onSelect={() => selectTag(item.scope, item.option)}
                    checked={isSelected(item.option.id)}
                    editing={editingId() === item.option.id}
                    selected={
                      dropdown.selectedIndex() === optionIndex(item.option.id)
                    }
                    showHotkey={
                      dropdown.shouldShowHotkeys() &&
                      optionIndex(item.option.id) <= 9
                    }
                    hotkeyShortcut={`${optionIndex(item.option.id)}`}
                    onMouseEnter={() => {
                      if (!dropdown.keyboardMode()) {
                        dropdown.setSelectedIndex(optionIndex(item.option.id));
                      }
                    }}
                    onEdit={() => setEditingId(item.option.id)}
                    onEditClose={() => setEditingId(null)}
                  />
                )}
              </For>
              <Show when={remainingTagOptions().length > 0}>
                <div class="my-1 border-t border-edge-muted" />
              </Show>
            </Show>

            <For each={['user', 'team'] as const}>
              {(scope) => (
                <Show when={remainingTagOptionsForScope(scope).length > 0}>
                  <div class="px-2 pb-1 pt-2 text-xs text-ink-extra-muted">
                    {SCOPE_LABEL[scope]}
                  </div>
                  <For each={remainingTagOptionsForScope(scope)}>
                    {(item) => (
                      <TagPickerRow
                        scope={scope}
                        option={item.option}
                        docTags={props.docTags}
                        replaceTag={props.replaceTag}
                        onSelect={() => selectTag(scope, item.option)}
                        checked={isSelected(item.option.id)}
                        editing={editingId() === item.option.id}
                        selected={
                          dropdown.selectedIndex() ===
                          optionIndex(item.option.id)
                        }
                        showHotkey={
                          dropdown.shouldShowHotkeys() &&
                          optionIndex(item.option.id) <= 9
                        }
                        hotkeyShortcut={`${optionIndex(item.option.id)}`}
                        onMouseEnter={() => {
                          if (!dropdown.keyboardMode()) {
                            dropdown.setSelectedIndex(
                              optionIndex(item.option.id)
                            );
                          }
                        }}
                        onEdit={() => setEditingId(item.option.id)}
                        onEditClose={() => setEditingId(null)}
                      />
                    )}
                  </For>
                </Show>
              )}
            </For>

            <Show when={showCreateRow()}>
              <CreateRow
                label={search().trim()}
                scope={createScope()}
                color={createColor()}
                hasTeamSet={hasTeamSet()}
                pending={addOption.isPending || ensureTagSet.isPending}
                onScope={setCreateScope}
                onColor={setCreateColor}
                onCreate={handleCreate}
                onCancel={() => setPickerSearch('')}
                selected={
                  dropdown.selectedIndex() === selectableItems().length - 1
                }
                onMouseEnter={() => {
                  if (!dropdown.keyboardMode()) {
                    dropdown.setSelectedIndex(selectableItems().length - 1);
                  }
                }}
              />
            </Show>

            <Show
              when={
                props.docTags
                  .tagSets()
                  .every((set) => set.options.length === 0) && !search().trim()
              }
            >
              <div class="px-2 py-4 text-center text-ink-muted">
                Type to create your first tag
              </div>
            </Show>
          </div>
        </Popover.Content>
      </Layer>
    </Popover.Portal>
  );
}

function TagPickerRow(props: {
  scope: TagScope;
  option: PropertyOptionResponse;
  docTags: DocTags;
  replaceTag?: ResolvedTag;
  onSelect: () => void | Promise<void>;
  checked: boolean;
  editing: boolean;
  selected: boolean;
  showHotkey: boolean;
  hotkeyShortcut: string;
  onMouseEnter: () => void;
  onEdit: () => void;
  onEditClose: () => void;
}) {
  const updateOption = useUpdatePropertyOptionMutation();
  const deleteOption = useDeletePropertyOptionMutation();
  const [confirmDelete, setConfirmDelete] = createSignal(false);
  const [draftLabel, setDraftLabel] = createSignal(optionLabel(props.option));
  const [draftColor, setDraftColor] = createSignal(
    props.option.color ?? DEFAULT_TAG_COLOR
  );

  const beginEdit = () => {
    setDraftLabel(optionLabel(props.option));
    setDraftColor(props.option.color ?? DEFAULT_TAG_COLOR);
    props.onEdit();
  };

  const saveEdit = async () => {
    const value = draftLabel().trim();
    await updateOption.mutateAsync({
      propertyDefinitionId: props.option.propertyDefinitionId,
      optionId: props.option.id,
      body: {
        value: value || undefined,
        color: draftColor(),
      },
    });
    props.onEditClose();
  };

  const handleDelete = async () => {
    await deleteOption.mutateAsync({
      propertyDefinitionId: props.option.propertyDefinitionId,
      optionId: props.option.id,
    });
    setConfirmDelete(false);
    props.onEditClose();
  };

  return (
    <Switch>
      <Match when={props.editing}>
        <div
          class="flex flex-col gap-2 rounded-lg bg-hover p-2"
          ref={scrollExpandedRowIntoView}
        >
          <div class="flex items-center gap-2">
            <TagDot color={draftColor()} />
            <input
              class="w-full bg-transparent caret-accent outline-none"
              value={draftLabel()}
              ref={focusWithoutScroll}
              onInput={(event) => setDraftLabel(event.currentTarget.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  saveEdit();
                }
              }}
            />
          </div>
          <ColorSwatchRow
            selected={draftColor()}
            onSelect={(color) => setDraftColor(color)}
          />
          <div class="flex items-center justify-between">
            <Button
              variant="ghost"
              size="sm"
              class="gap-1.5 text-failure-ink"
              onClick={() => setConfirmDelete(true)}
            >
              <Trash class="size-3.5" />
              Delete
            </Button>
            <div class="flex items-center gap-1.5">
              <Button variant="ghost" size="sm" onClick={props.onEditClose}>
                Cancel
              </Button>
              <Button
                variant="base"
                size="sm"
                onClick={saveEdit}
                disabled={updateOption.isPending}
              >
                Save
              </Button>
            </div>
          </div>
        </div>
        <DeleteConfirm
          open={confirmDelete()}
          label={optionLabel(props.option)}
          onCancel={() => setConfirmDelete(false)}
          onConfirm={handleDelete}
        />
      </Match>
      <Match when={!props.editing}>
        <DropdownSelectableRow
          isSelected={props.selected}
          onClick={() => void props.onSelect()}
          onMouseEnter={props.onMouseEnter}
          showHotkey={props.showHotkey}
          hotkeyShortcut={props.hotkeyShortcut}
          rightContent={
            <button
              type="button"
              class="shrink-0 rounded-md p-1 text-ink-muted opacity-0 hover:bg-active hover:text-ink group-hover:opacity-100"
              aria-label={`Edit ${optionLabel(props.option)}`}
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                beginEdit();
              }}
            >
              <PencilSimple class="size-3.5" />
            </button>
          }
        >
          <OptionCheckBox checked={props.checked} multiselect />
          <TagDot color={props.option.color ?? undefined} />
          <span class="min-w-0 flex-1 truncate">
            {optionLabel(props.option)}
          </span>
        </DropdownSelectableRow>
      </Match>
    </Switch>
  );
}

function CreateRow(props: {
  label: string;
  scope: TagScope;
  color: string;
  hasTeamSet: boolean;
  pending: boolean;
  onScope: (scope: TagScope) => void;
  onColor: (color: string) => void;
  onCreate: () => void;
  onCancel: () => void;
  selected: boolean;
  onMouseEnter: () => void;
}) {
  return (
    <div
      class={cn(
        'mt-1 flex flex-col gap-2 rounded-lg border border-edge-muted p-2',
        props.selected && 'bg-hover'
      )}
      ref={scrollExpandedRowIntoView}
      onMouseEnter={props.onMouseEnter}
    >
      <div class="flex items-center gap-2">
        <TagDot color={props.color} />
        <span class="min-w-0 flex-1 truncate">New tag "{props.label}"</span>
      </div>
      <ColorSwatchRow selected={props.color} onSelect={props.onColor} />
      <Show when={props.hasTeamSet}>
        <div class="flex items-center gap-1">
          <For each={['user', 'team'] as const}>
            {(scope) => (
              <button
                type="button"
                class={cn(
                  'rounded-md px-2 py-0.5 text-xs',
                  props.scope === scope
                    ? 'bg-accent text-surface'
                    : 'text-ink-muted hover:bg-hover'
                )}
                onClick={() => props.onScope(scope)}
              >
                {scope === 'user' ? 'My tag' : 'Team tag'}
              </button>
            )}
          </For>
        </div>
      </Show>
      <div class="flex items-center justify-end gap-1.5">
        <Button variant="ghost" size="sm" onClick={props.onCancel}>
          Cancel
        </Button>
        <Button
          variant="base"
          size="sm"
          onClick={props.onCreate}
          disabled={props.pending}
        >
          Create
        </Button>
      </div>
    </div>
  );
}

function ColorSwatchRow(props: {
  selected: string;
  onSelect: (color: string) => void;
}) {
  return (
    <div class="flex flex-wrap items-center gap-1.5">
      <For each={TAG_COLORS}>
        {(color) => (
          <button
            type="button"
            class={cn(
              'size-4 rounded-full ring-offset-1 ring-offset-surface',
              props.selected === color ? 'ring-2 ring-ink' : 'ring-0'
            )}
            style={{ 'background-color': color }}
            aria-label={`Color ${color}`}
            onClick={() => props.onSelect(color)}
          />
        )}
      </For>
    </div>
  );
}

function DeleteConfirm(props: {
  open: boolean;
  label: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <Dialog open={props.open} position="center" onOpenChange={props.onCancel}>
      <div class="rounded-xl bg-surface p-4 text-sm ring ring-edge-muted">
        <div class="text-ink">Delete tag "{props.label}"?</div>
        <p class="mt-1 text-ink-muted">
          It will be removed from every item it's applied to.
        </p>
        <div class="mt-4 flex items-center justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={props.onCancel}>
            Cancel
          </Button>
          <Button variant="danger" size="sm" onClick={props.onConfirm}>
            Delete
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
