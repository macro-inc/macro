import { useSplitLayout } from '@components/app/split-layout/layout';
import { useSplitPanel } from '@components/app/split-layout/layoutUtils';
import { Popover } from '@kobalte/core/popover';
import CircleDashedEmpty from '@phosphor/circle-dashed.svg';
import FilterIcon from '@phosphor/funnel-simple.svg';
import PencilIcon from '@phosphor/pencil-simple.svg';
import PlusIcon from '@phosphor/plus.svg';
import { OptionCheckBox } from '@property/editors/selectors/OptionCheckBox';
import {
  DropdownSearchInput,
  DropdownSelectableRow,
  useDropdownSearch,
} from '@property/editors/selectors/PropertyOptionSelector';
import { useAddPropertyOptionMutation } from '@queries/properties/options';
import {
  type CreateTagResult,
  invalidateTags,
  useEnsureTagSetMutation,
} from '@queries/properties/tags';
import { useCurrentTeamQuery } from '@queries/team/teams';
import type { PropertyOptionResponse } from '@service-properties/generated/schemas/propertyOptionResponse';
import type { TagScope } from '@service-properties/generated/schemas/tagScope';
import { Button, Layer } from '@ui';
import {
  createEffect,
  createMemo,
  createSignal,
  For,
  type JSX,
  onCleanup,
  onMount,
  Show,
  untrack,
} from 'solid-js';
import { TagDot } from './TagDot';
import {
  type EditableTag,
  TagEditorDialog,
  type TagEditorDialogMode,
} from './TagEditorDialog';
import { DEFAULT_TAG_COLOR, TAG_COLOR_OPTIONS } from './tagColors';
import { navigateToTag } from './tagNavigation';
import type { ResolvedTag, useDocTags } from './useDocTags';

type DocTags = ReturnType<typeof useDocTags>;

type TagOptionItem = {
  scope: TagScope;
  option: PropertyOptionResponse;
};

type CreateStep = 'color' | 'scope';
type CreateTagSuccessHandler = (
  result: CreateTagResult
) => void | Promise<void>;

function optionLabel(option: PropertyOptionResponse): string {
  return option.value.type === 'string' ? option.value.value : '';
}

function nextDisplayOrder(options: PropertyOptionResponse[]): number {
  return (
    options.reduce((max, option) => Math.max(max, option.displayOrder), -1) + 1
  );
}

const MAX_LIST_HEIGHT = 192;
const tagActionButtonClass =
  'size-5 shrink-0 p-0.5 text-ink-extra-muted opacity-0 group-hover:opacity-100 focus-visible:opacity-100 [&_:where(svg)]:size-3.5';

export type TagPickerSourceProps =
  | { docTags: DocTags; createDocTags?: never }
  | { docTags?: never; createDocTags: () => DocTags };

export type TagPickerProps = {
  replaceTag?: ResolvedTag;
  triggerClass?: string;
  triggerLabel: string;
  children: JSX.Element;
  onOpenChange?: (open: boolean) => void;
  /**
   * Prevent the click that dismisses the picker from activating the element
   * behind it. This matches inline property editors rendered in soup rows.
   */
  withClickBlock?: boolean;
} & TagPickerSourceProps;

export function TagPicker(props: TagPickerProps) {
  const [open, setOpen] = createSignal(false);
  const [editorMode, setEditorMode] = createSignal<TagEditorDialogMode | null>(
    null
  );
  const [createSuccessHandler, setCreateSuccessHandler] =
    createSignal<CreateTagSuccessHandler>();
  let saveAndClose: (() => Promise<void>) | undefined;
  let triggerRef: HTMLButtonElement | undefined;

  const restoreFocusToTrigger = () => {
    setTimeout(() => {
      triggerRef?.isConnected && triggerRef.focus();
    }, 0);
  };

  const setOpenState = (
    value: boolean,
    options?: { restoreFocus?: boolean }
  ) => {
    setOpen(value);
    props.onOpenChange?.(value);
    if (!value && options?.restoreFocus) {
      restoreFocusToTrigger();
    }
  };

  const handleOpenChange = (value: boolean) => {
    if (value) {
      setOpenState(true);
      return;
    }

    if (saveAndClose) {
      void saveAndClose();
    } else {
      setOpenState(false, { restoreFocus: true });
    }
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
        ref={triggerRef}
        class={props.triggerClass}
        aria-label={props.triggerLabel}
      >
        {props.children}
      </Popover.Trigger>
      <Show when={open() || editorMode() !== null}>
        <TagPickerBodyOwner
          docTags={props.docTags}
          createDocTags={props.createDocTags}
          open={open}
          editorMode={editorMode}
          onClose={() => setOpenState(false, { restoreFocus: true })}
          onOpenCreateEditor={(mode, onCreateSuccess) => {
            setCreateSuccessHandler(() => onCreateSuccess);
            setEditorMode(mode);
            setOpenState(false);
          }}
          onOpenEditEditor={(mode) => {
            setEditorMode(mode);
            setOpenState(false);
          }}
          registerSave={(handler) => {
            saveAndClose = handler;
          }}
          createSuccessHandler={createSuccessHandler}
          onEditorClose={() => {
            setEditorMode(null);
            setCreateSuccessHandler(undefined);
            restoreFocusToTrigger();
          }}
          withClickBlock={props.withClickBlock ?? false}
        />
      </Show>
    </Popover>
  );
}

function TagPickerBodyOwner(props: {
  docTags?: DocTags;
  createDocTags?: () => DocTags;
  open: () => boolean;
  editorMode: () => TagEditorDialogMode | null;
  onClose: () => void;
  onOpenCreateEditor: (
    mode: Extract<TagEditorDialogMode, { type: 'create' }>,
    onCreateSuccess?: CreateTagSuccessHandler
  ) => void;
  onOpenEditEditor: (
    mode: Extract<TagEditorDialogMode, { type: 'edit' }>
  ) => void;
  registerSave: (handler: (() => Promise<void>) | undefined) => void;
  createSuccessHandler: () => CreateTagSuccessHandler | undefined;
  onEditorClose: () => void;
  withClickBlock: boolean;
}) {
  // The factory is invoked under this conditionally-mounted component owner,
  // so row-level query/mutation hooks do not exist until the picker opens.
  const docTags = props.docTags ?? props.createDocTags?.();
  if (!docTags) throw new Error('TagPicker requires a doc-tags source');
  const currentTeamQuery = useCurrentTeamQuery();

  return (
    <>
      <Show when={props.open()}>
        <TagPickerBody
          docTags={docTags}
          onClose={props.onClose}
          onOpenCreateEditor={props.onOpenCreateEditor}
          onOpenEditEditor={props.onOpenEditEditor}
          registerSave={props.registerSave}
          suppressInitialOutsideEvents={false}
          withClickBlock={props.withClickBlock}
        />
      </Show>
      <Show when={props.editorMode()}>
        <TagEditorDialog
          open
          mode={props.editorMode()}
          teamAvailable={Boolean(currentTeamQuery.data?.team)}
          onCreateSuccess={async (result) => {
            await props.createSuccessHandler()?.(result);
          }}
          onClose={props.onEditorClose}
        />
      </Show>
    </>
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
  const [editorMode, setEditorMode] = createSignal<TagEditorDialogMode | null>(
    null
  );
  const [createSuccessHandler, setCreateSuccessHandler] =
    createSignal<CreateTagSuccessHandler>();
  const currentTeamQuery = useCurrentTeamQuery();
  let saveAndClose: (() => Promise<void>) | undefined;

  const handleOpenChange = (value: boolean) => {
    if (value) {
      props.onOpenChange(true);
      return;
    }

    if (saveAndClose) {
      void saveAndClose();
    } else {
      props.onOpenChange(false);
    }
  };

  return (
    <>
      <Popover
        open={props.open}
        onOpenChange={handleOpenChange}
        getAnchorRect={props.getAnchorRect}
        placement="bottom-start"
        gutter={4}
      >
        <Show when={props.open}>
          <TagPickerBody
            docTags={props.docTags}
            onClose={() => props.onOpenChange(false)}
            onOpenCreateEditor={(mode, onCreateSuccess) => {
              setCreateSuccessHandler(() => onCreateSuccess);
              setEditorMode(mode);
              props.onOpenChange(false);
            }}
            onOpenEditEditor={(mode) => {
              setEditorMode(mode);
              props.onOpenChange(false);
            }}
            registerSave={(handler) => {
              saveAndClose = handler;
            }}
            suppressInitialOutsideEvents
          />
        </Show>
      </Popover>
      <TagEditorDialog
        open={editorMode() !== null}
        mode={editorMode()}
        teamAvailable={Boolean(currentTeamQuery.data?.team)}
        onCreateSuccess={async (result) => {
          await createSuccessHandler()?.(result);
        }}
        onClose={() => {
          setEditorMode(null);
          setCreateSuccessHandler(undefined);
        }}
      />
    </>
  );
}

function TagPickerBody(props: {
  docTags: DocTags;
  onClose: () => void;
  onOpenCreateEditor: (
    mode: Extract<TagEditorDialogMode, { type: 'create' }>,
    onCreateSuccess?: CreateTagSuccessHandler
  ) => void;
  onOpenEditEditor: (
    mode: Extract<TagEditorDialogMode, { type: 'edit' }>
  ) => void;
  registerSave: (handler: (() => Promise<void>) | undefined) => void;
  suppressInitialOutsideEvents: boolean;
  withClickBlock?: boolean;
}) {
  const [search, setSearch] = createSignal('');
  const [saved, setSaved] = createSignal(false);
  const [selectedIds, setSelectedIds] = createSignal<Set<string>>(
    new Set(props.docTags.appliedTags().map((tag) => tag.optionId))
  );
  const [createStep, setCreateStep] = createSignal<CreateStep | null>(null);
  const [createDraftLabel, setCreateDraftLabel] = createSignal('');
  const [selectedColorIndex, setSelectedColorIndex] = createSignal(0);
  const [selectedScopeIndex, setSelectedScopeIndex] = createSignal(0);
  const currentTeamQuery = useCurrentTeamQuery();
  const addOption = useAddPropertyOptionMutation();
  const ensureTagSet = useEnsureTagSetMutation();
  const split = useSplitLayout();
  const panel = useSplitPanel();
  let scrollContainerRef: HTMLDivElement | undefined;
  const [initialOutsideEventGuard, setInitialOutsideEventGuard] =
    createSignal(true);
  const shouldIgnoreOutsideEvent = () =>
    props.suppressInitialOutsideEvents && initialOutsideEventGuard();

  const blockDismissalClick = () => {
    if (!props.withClickBlock) return;

    // Kobalte closes popovers on an outside interaction but leaves the
    // following click to bubble through to the row beneath it.
    const swallow = (clickEvent: PointerEvent) => {
      clickEvent.stopPropagation();
      clickEvent.preventDefault();
    };
    window.addEventListener('click', swallow, {
      capture: true,
      once: true,
    });
    window.addEventListener(
      'pointerdown',
      () => {
        window.removeEventListener('click', swallow, {
          capture: true,
        });
      },
      { capture: true, once: true }
    );
  };

  const initialAppliedTags = createMemo(() => props.docTags.appliedTags());
  const initialAppliedIds = createMemo(
    () => new Set(initialAppliedTags().map((tag) => tag.optionId))
  );
  const initialTagState = createMemo(() => {
    const optionScopes = new Map<string, TagScope>();
    const optionsById = new Map<string, PropertyOptionResponse>();
    const itemsByScope = new Map<TagScope, TagOptionItem[]>();

    for (const set of props.docTags.tagSets()) {
      for (const option of set.options) {
        optionsById.set(option.id, option);
      }

      itemsByScope.set(
        set.scope,
        [...set.options]
          .sort((a, b) => a.displayOrder - b.displayOrder)
          .map((option) => {
            optionScopes.set(option.id, set.scope);
            return {
              scope: set.scope,
              option,
            };
          })
      );
    }

    const selectedItems = initialAppliedTags().flatMap((tag) => {
      const option = optionsById.get(tag.optionId);
      return option ? [{ scope: tag.scope, option }] : [];
    });

    return {
      optionScopes,
      itemsByScope,
      selectedItems,
      items: [...itemsByScope.values()].flat(),
    };
  });

  createEffect(() => {
    const appliedTags = initialAppliedTags();
    if (untrack(saved)) return;
    setSelectedIds(new Set(appliedTags.map((tag) => tag.optionId)));
  });

  const isSelected = (optionId: string) => selectedIds().has(optionId);

  const toggleSelected = (optionId: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(optionId)) next.delete(optionId);
      else next.add(optionId);
      return next;
    });
  };

  const persistSelection = async () => {
    if (saved()) return true;
    setSaved(true);

    try {
      await props.docTags.setTagSelection(selectedIds());
      return true;
    } catch (error) {
      setSaved(false);
      console.error('Failed to persist tag selection', error);
      return false;
    }
  };

  const save = async () => {
    return persistSelection();
  };

  const saveAndClose = async () => {
    const savePromise = save();
    props.onClose();
    await savePromise;
  };

  const filteredItems = createMemo(() => {
    const query = search().trim().toLowerCase();
    const matchesSearch = (item: TagOptionItem) =>
      !query || optionLabel(item.option).toLowerCase().includes(query);

    const selectedAtOpen =
      initialTagState().selectedItems.filter(matchesSearch);
    const remainingForScope = (scope: TagScope) =>
      (initialTagState().itemsByScope.get(scope) ?? []).filter(
        (item) =>
          !initialAppliedIds().has(item.option.id) && matchesSearch(item)
      );

    return [
      ...selectedAtOpen,
      ...remainingForScope('user'),
      ...remainingForScope('team'),
    ];
  });

  const selectedAtOpenItems = createMemo(() => {
    const query = search().trim().toLowerCase();
    return initialTagState().selectedItems.filter(
      (item) => !query || optionLabel(item.option).toLowerCase().includes(query)
    );
  });

  const remainingItemsForScope = (scope: TagScope) => {
    const query = search().trim().toLowerCase();
    return (initialTagState().itemsByScope.get(scope) ?? []).filter(
      (item) =>
        !initialAppliedIds().has(item.option.id) &&
        (!query || optionLabel(item.option).toLowerCase().includes(query))
    );
  };

  const createLabel = () => search().trim();
  const exactTagMatchExists = () => {
    const label = createLabel().toLowerCase();
    return (
      !!label &&
      initialTagState().items.some(
        (item) => optionLabel(item.option).toLowerCase() === label
      )
    );
  };
  const showCreateRow = () =>
    createLabel().length > 0 && !exactTagMatchExists();
  const showClearAllRow = () =>
    selectedIds().size > 0 && !search().trim() && !createStep();
  const showCreateRowDivider = () =>
    showCreateRow() && (filteredItems().length > 0 || showClearAllRow());
  const itemIndex = (item: TagOptionItem) => filteredItems().indexOf(item);
  const clearAllRowIndex = () => filteredItems().length;
  const createRowIndex = () =>
    filteredItems().length + (showClearAllRow() ? 1 : 0);
  const teamName = () => currentTeamQuery.data?.team.name?.trim() || 'Team';
  const scopeOptions = createMemo<{ scope: TagScope; label: string }[]>(() => [
    { scope: 'team', label: `Shared with ${teamName()}` },
    { scope: 'user', label: 'Personal' },
  ]);
  const selectedColor = () =>
    TAG_COLOR_OPTIONS[selectedColorIndex()]?.color ?? DEFAULT_TAG_COLOR;
  const createItemCount = () =>
    createStep() === 'color' ? TAG_COLOR_OPTIONS.length : scopeOptions().length;

  const beginCreate = () => {
    const label = createLabel();
    if (!showCreateRow() || !label) return;
    setCreateDraftLabel(label);
    setSelectedColorIndex(0);
    setSelectedScopeIndex(0);
    setCreateStep('color');
  };

  const editableTagForItem = (item: TagOptionItem): EditableTag => ({
    scope: item.scope,
    propertyDefinitionId: item.option.propertyDefinitionId,
    option: item.option,
  });

  const beginEdit = async (item: TagOptionItem) => {
    if (!(await persistSelection())) return;
    props.onOpenEditEditor({
      type: 'edit',
      tag: editableTagForItem(item),
    });
  };

  const openTaggedItems = async (item: TagOptionItem) => {
    if (!(await persistSelection())) return;
    props.onClose();
    navigateToTag(
      split.openWithSplit,
      {
        optionId: item.option.id,
        propertyDefinitionId: item.option.propertyDefinitionId,
      },
      { handle: panel?.handle }
    );
  };

  const createTag = async (scope: TagScope) => {
    const value = createDraftLabel().trim();
    if (!value) return;

    try {
      if (!(await persistSelection())) return;

      const provisioned = await ensureTagSet.mutateAsync({ scope });
      if (!provisioned.definition) return;

      const created = await addOption.mutateAsync({
        propertyDefinitionId: provisioned.definition.id,
        body: {
          type: 'select_string',
          option: {
            value,
            display_order: nextDisplayOrder(provisioned.options),
            color: selectedColor(),
          },
        },
      });
      invalidateTags();
      await props.docTags.applyTag(scope, created.id);
      props.onClose();
    } catch (error) {
      console.error('Failed to create tag', error);
    }
  };

  const handleCreateKeyDown = (event: KeyboardEvent) => {
    const step = createStep();
    if (!step) return;

    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      if (step === 'scope') {
        setCreateStep('color');
        return;
      }
      setCreateStep(null);
      return;
    }

    const count = createItemCount();
    if (count === 0) return;

    if (event.key === 'ArrowDown' || (event.ctrlKey && event.key === 'j')) {
      event.preventDefault();
      if (step === 'color') {
        setSelectedColorIndex((prev) => (prev + 1) % count);
      } else {
        setSelectedScopeIndex((prev) => (prev + 1) % count);
      }
    } else if (
      event.key === 'ArrowUp' ||
      (event.ctrlKey && event.key === 'k')
    ) {
      event.preventDefault();
      if (step === 'color') {
        setSelectedColorIndex((prev) => (prev - 1 + count) % count);
      } else {
        setSelectedScopeIndex((prev) => (prev - 1 + count) % count);
      }
    } else if (event.key === 'Enter') {
      event.preventDefault();
      if (step === 'color') {
        setCreateStep('scope');
      } else {
        const scope = scopeOptions()[selectedScopeIndex()]?.scope;
        if (scope) void createTag(scope);
      }
    }
  };

  const dropdown = useDropdownSearch({
    itemCount: () =>
      filteredItems().length +
      (showClearAllRow() ? 1 : 0) +
      (showCreateRow() ? 1 : 0),
    onSelect: (index, event) => {
      if (showCreateRow() && index === createRowIndex()) {
        beginCreate();
        return;
      }

      if (showClearAllRow() && index === clearAllRowIndex()) {
        setSelectedIds(new Set<string>());
        void saveAndClose();
        return;
      }

      const item = filteredItems()[index];
      if (!item) return;

      toggleSelected(item.option.id);
      if (!event?.shiftKey) saveAndClose();
    },
    onClose: saveAndClose,
    enableNumericHotkeys: false,
  });

  // Reset selected index to top when search term or list changes.
  createEffect(() => {
    if (createStep()) return;
    search();
    filteredItems().length;
    dropdown.setSelectedIndex(0);
  });

  createEffect(() => {
    if (createStep()) return;
    const index = dropdown.selectedIndex();
    if (!dropdown.keyboardMode() || !scrollContainerRef) return;

    const row = scrollContainerRef.querySelector<HTMLDivElement>(
      `[data-tag-index="${index}"]`
    );
    row?.scrollIntoView({ block: 'nearest' });
  });

  const handleKeyDown = (event: KeyboardEvent) => {
    if (saved()) return;
    if (createStep()) {
      handleCreateKeyDown(event);
      return;
    }
    dropdown.handleKeyDown(event);
  };

  onMount(() => {
    props.registerSave(saveAndClose);
    document.addEventListener('keydown', handleKeyDown);
    const timeout = setTimeout(() => {
      setInitialOutsideEventGuard(false);
    }, 100);
    onCleanup(() => clearTimeout(timeout));
  });

  onCleanup(() => {
    props.registerSave(undefined);
    document.removeEventListener('keydown', handleKeyDown);
  });

  return (
    <Popover.Portal>
      <Layer depth={3}>
        <Popover.Content
          class="z-modal w-96 max-w-[min(24rem,calc(100vw-1.5rem))] rounded-xl border border-edge-muted bg-surface text-sm shadow-menu menu-open-animation"
          onCloseAutoFocus={(event) => event.preventDefault()}
          onFocusOutside={(event) => {
            if (shouldIgnoreOutsideEvent()) event.preventDefault();
          }}
          onInteractOutside={(event) => {
            if (shouldIgnoreOutsideEvent()) {
              event.preventDefault();
              return;
            }
            blockDismissalClick();
          }}
        >
          <Show
            when={createStep()}
            fallback={
              <>
                <DropdownSearchInput
                  value={search()}
                  placeholder="Change or add tags"
                  onInput={(value) => {
                    setSearch(value);
                    dropdown.setSearchQuery(value);
                  }}
                />
                <div class="p-1.5">
                  <div
                    ref={scrollContainerRef}
                    class="overflow-y-auto overflow-x-hidden scrollbar-hidden"
                    style={{ 'max-height': `${MAX_LIST_HEIGHT}px` }}
                  >
                    <Show
                      when={
                        showClearAllRow() ||
                        filteredItems().length > 0 ||
                        showCreateRow()
                      }
                      fallback={
                        <div class="px-2 py-4 text-center text-ink-muted">
                          {initialTagState().items.length === 0
                            ? 'No tags available'
                            : 'No tags match your search'}
                        </div>
                      }
                    >
                      <For each={selectedAtOpenItems()}>
                        {(item) => (
                          <TagPickerRow
                            item={item}
                            index={itemIndex(item)}
                            teamName={teamName()}
                            checked={isSelected(item.option.id)}
                            selected={
                              dropdown.selectedIndex() === itemIndex(item)
                            }
                            onSelect={(event) => {
                              toggleSelected(item.option.id);
                              if (!event.shiftKey) saveAndClose();
                            }}
                            onEdit={() => void beginEdit(item)}
                            onOpenTag={() => void openTaggedItems(item)}
                            onMouseEnter={() => {
                              if (!dropdown.keyboardMode()) {
                                dropdown.setSelectedIndex(itemIndex(item));
                              }
                            }}
                          />
                        )}
                      </For>
                      <Show
                        when={
                          selectedAtOpenItems().length > 0 &&
                          (remainingItemsForScope('user').length > 0 ||
                            remainingItemsForScope('team').length > 0)
                        }
                      >
                        <div class="my-1 border-t border-edge-muted" />
                      </Show>
                      <For each={['user', 'team'] as const}>
                        {(scope) => (
                          <For each={remainingItemsForScope(scope)}>
                            {(item) => (
                              <TagPickerRow
                                item={item}
                                index={itemIndex(item)}
                                teamName={teamName()}
                                checked={isSelected(item.option.id)}
                                selected={
                                  dropdown.selectedIndex() === itemIndex(item)
                                }
                                onSelect={(event) => {
                                  toggleSelected(item.option.id);
                                  if (!event.shiftKey) saveAndClose();
                                }}
                                onEdit={() => void beginEdit(item)}
                                onOpenTag={() => void openTaggedItems(item)}
                                onMouseEnter={() => {
                                  if (!dropdown.keyboardMode()) {
                                    dropdown.setSelectedIndex(itemIndex(item));
                                  }
                                }}
                              />
                            )}
                          </For>
                        )}
                      </For>
                      <Show when={showClearAllRow()}>
                        <div class="my-1 border-t border-edge-muted" />
                        <div data-tag-index={clearAllRowIndex()}>
                          <DropdownSelectableRow
                            isSelected={
                              dropdown.selectedIndex() === clearAllRowIndex()
                            }
                            onClick={() => {
                              setSelectedIds(new Set<string>());
                              void saveAndClose();
                            }}
                            onMouseEnter={() => {
                              if (!dropdown.keyboardMode()) {
                                dropdown.setSelectedIndex(clearAllRowIndex());
                              }
                            }}
                          >
                            <CircleDashedEmpty class="size-3 shrink-0 text-ink-extra-muted" />
                            <div class="min-w-0 flex-1 text-left">
                              <p class="truncate text-ink-muted">
                                Clear all tags
                              </p>
                            </div>
                          </DropdownSelectableRow>
                        </div>
                      </Show>
                    </Show>
                  </div>
                  <Show when={showCreateRow()}>
                    <div
                      classList={{
                        'mt-1 border-t border-edge-muted pt-1':
                          showCreateRowDivider(),
                      }}
                    >
                      <CreateTagRow
                        index={createRowIndex()}
                        label={createLabel()}
                        selected={dropdown.selectedIndex() === createRowIndex()}
                        onClick={beginCreate}
                        onMouseEnter={() => {
                          if (!dropdown.keyboardMode()) {
                            dropdown.setSelectedIndex(createRowIndex());
                          }
                        }}
                      />
                    </div>
                  </Show>
                </div>
              </>
            }
          >
            {(step) => (
              <CreateTagFlow
                step={step()}
                label={createDraftLabel()}
                colorOptions={TAG_COLOR_OPTIONS}
                selectedColorIndex={selectedColorIndex()}
                scopeOptions={scopeOptions()}
                selectedScopeIndex={selectedScopeIndex()}
                pending={addOption.isPending || ensureTagSet.isPending}
                onColorMouseEnter={setSelectedColorIndex}
                onColorSelect={(index) => {
                  setSelectedColorIndex(index);
                  setCreateStep('scope');
                }}
                onScopeMouseEnter={setSelectedScopeIndex}
                onScopeSelect={(scope) => void createTag(scope)}
              />
            )}
          </Show>
        </Popover.Content>
      </Layer>
    </Popover.Portal>
  );
}

function TagPickerRow(props: {
  item: TagOptionItem;
  index: number;
  teamName: string;
  checked: boolean;
  selected: boolean;
  onSelect: (event: MouseEvent) => void;
  onEdit: () => void;
  onOpenTag: () => void;
  onMouseEnter: () => void;
}) {
  const label = () => optionLabel(props.item.option);

  return (
    <div data-tag-index={props.index}>
      <DropdownSelectableRow
        isSelected={props.selected}
        onClick={props.onSelect}
        onMouseEnter={props.onMouseEnter}
        rightContent={
          <div class="flex items-center gap-1">
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              noTouchResize
              tooltip="View tagged items"
              aria-label={`View all items with tag ${label()}`}
              class={tagActionButtonClass}
              onMouseDown={(event) => {
                event.preventDefault();
                event.stopPropagation();
              }}
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                props.onOpenTag();
              }}
            >
              <FilterIcon class="size-3.5" />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              noTouchResize
              tooltip="Edit tag"
              aria-label={`Edit ${label()}`}
              class={tagActionButtonClass}
              onMouseDown={(event) => {
                event.preventDefault();
                event.stopPropagation();
              }}
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                props.onEdit();
              }}
            >
              <PencilIcon class="size-3.5" />
            </Button>
          </div>
        }
      >
        <OptionCheckBox checked={props.checked} multiselect />
        <TagDot color={props.item.option.color ?? undefined} />
        <span class="min-w-0 flex-1 truncate">{label()}</span>
        <Show when={props.item.scope === 'team'}>
          <span class="max-w-20 shrink-0 truncate rounded-full border border-ink/5 px-1.5 py-0.5 text-[10px] leading-none text-ink-extra-muted">
            {props.teamName}
          </span>
        </Show>
      </DropdownSelectableRow>
    </div>
  );
}

function CreateTagRow(props: {
  index: number;
  label: string;
  selected: boolean;
  onClick: () => void;
  onMouseEnter: () => void;
}) {
  return (
    <div
      data-tag-index={props.index}
      class="rounded-lg w-full flex items-center gap-2 p-1.5 px-2 text-left text-ink font-normal cursor-default"
      classList={{
        'bg-hover': props.selected,
      }}
      onClick={props.onClick}
      onMouseEnter={props.onMouseEnter}
    >
      <div class="size-3 shrink-0 text-ink-muted">
        <PlusIcon class="size-3" />
      </div>
      <span class="min-w-0 flex-1 truncate">
        Create new tag "{props.label}"
      </span>
    </div>
  );
}

function CreateTagFlow(props: {
  step: CreateStep;
  label: string;
  colorOptions: typeof TAG_COLOR_OPTIONS;
  selectedColorIndex: number;
  scopeOptions: { scope: TagScope; label: string }[];
  selectedScopeIndex: number;
  pending: boolean;
  onColorMouseEnter: (index: number) => void;
  onColorSelect: (index: number) => void;
  onScopeMouseEnter: (index: number) => void;
  onScopeSelect: (scope: TagScope) => void;
}) {
  return (
    <div class="p-1.5">
      <div class="px-2 pb-1 pt-1 text-xs text-ink-extra-muted">
        Create tag "{props.label}"
      </div>
      <Show
        when={props.step === 'color'}
        fallback={
          <For each={props.scopeOptions}>
            {(option, index) => (
              <DropdownSelectableRow
                isSelected={props.selectedScopeIndex === index()}
                onMouseEnter={() => props.onScopeMouseEnter(index())}
                onClick={() => props.onScopeSelect(option.scope)}
              >
                <TagDot
                  color={
                    props.colorOptions[props.selectedColorIndex]?.color ??
                    DEFAULT_TAG_COLOR
                  }
                />
                <span class="min-w-0 flex-1 truncate">{option.label}</span>
                <Show
                  when={props.pending && props.selectedScopeIndex === index()}
                >
                  <span class="text-xs text-ink-muted">Creating...</span>
                </Show>
              </DropdownSelectableRow>
            )}
          </For>
        }
      >
        <For each={props.colorOptions}>
          {(option, index) => (
            <DropdownSelectableRow
              isSelected={props.selectedColorIndex === index()}
              onMouseEnter={() => props.onColorMouseEnter(index())}
              onClick={() => props.onColorSelect(index())}
            >
              <TagDot color={option.color} />
              <span class="min-w-0 flex-1 truncate">{option.name}</span>
            </DropdownSelectableRow>
          )}
        </For>
      </Show>
    </div>
  );
}
