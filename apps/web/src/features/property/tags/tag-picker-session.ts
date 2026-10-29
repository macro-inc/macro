import { useSplitLayout } from '@components/app/split-layout/layout';
import { useSplitPanel } from '@components/app/split-layout/layoutUtils';
import { fireAndForget } from '@core/util/fireAndForget';
import { useDropdownSearch } from '@property/editors/selectors/PropertyOptionSelector';
import { useAddPropertyOptionMutation } from '@queries/properties/options';
import {
  type CreateTagResult,
  invalidateTags,
  useEnsureTagSetMutation,
} from '@queries/properties/tags';
import { useCurrentTeamQuery } from '@queries/team/teams';
import type { PropertyOptionResponse } from '@service-properties/generated/schemas/propertyOptionResponse';
import type { TagScope } from '@service-properties/generated/schemas/tagScope';
import {
  createEffect,
  createMemo,
  createSignal,
  onCleanup,
  onMount,
  untrack,
} from 'solid-js';
import type { EditableTag, TagEditorDialogMode } from './TagEditorDialog';
import { DEFAULT_TAG_COLOR, TAG_COLOR_OPTIONS } from './tagColors';
import { navigateToTag } from './tagNavigation';
import type { useDocTags } from './useDocTags';

export type DocTags = ReturnType<typeof useDocTags>;

export type TagOptionItem = {
  scope: TagScope;
  option: PropertyOptionResponse;
};

export type CreateStep = 'color' | 'scope';
export type CreateTagSuccessHandler = (
  result: CreateTagResult
) => void | Promise<void>;

export function optionLabel(option: PropertyOptionResponse): string {
  return option.value.type === 'string' ? option.value.value : '';
}

function nextDisplayOrder(options: PropertyOptionResponse[]): number {
  return (
    options.reduce((max, option) => Math.max(max, option.displayOrder), -1) + 1
  );
}

/**
 * One tag picker session: the staged selection, search, keyboard navigation,
 * and tag creation, shared by the popover and the touch sheet.
 */
export function createTagPickerSession(props: {
  docTags: DocTags;
  onClose: () => void;
  onOpenEditEditor: (
    mode: Extract<TagEditorDialogMode, { type: 'edit' }>
  ) => void;
  /**
   * A sheet with Done: picking a tag, or clearing them all, keeps the picker
   * open, and Escape cancels. A popover instead saves and closes on a pick,
   * and Escape saves.
   */
  confirmsWithDone: boolean;
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

  /** Toggle a tag; a picker that closes on pick saves unless Shift is held. */
  const pick = (item: TagOptionItem, event?: { shiftKey?: boolean }) => {
    toggleSelected(item.option.id);
    if (!props.confirmsWithDone && !event?.shiftKey) {
      fireAndForget(saveAndClose(), 'tag-picker');
    }
  };

  const clearAll = () => {
    setSelectedIds(new Set<string>());
    if (!props.confirmsWithDone) fireAndForget(saveAndClose(), 'tag-picker');
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
        if (scope) fireAndForget(createTag(scope), 'tag-picker');
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
        clearAll();
        return;
      }

      const item = filteredItems()[index];
      if (item) pick(item, event);
    },
    onClose: () => (props.confirmsWithDone ? props.onClose() : saveAndClose()),
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
    document.addEventListener('keydown', handleKeyDown);
  });
  onCleanup(() => {
    document.removeEventListener('keydown', handleKeyDown);
  });

  return {
    search,
    setSearch: (value: string) => {
      setSearch(value);
      dropdown.setSearchQuery(value);
    },
    isSelected,
    pick,
    clearAll,
    persistSelection,
    saveAndClose,
    filteredItems,
    selectedAtOpenItems,
    remainingItemsForScope,
    hasTags: () => initialTagState().items.length > 0,
    showCreateRow,
    showClearAllRow,
    showCreateRowDivider,
    itemIndex,
    clearAllRowIndex,
    createRowIndex,
    createLabel,
    teamName,
    scopeOptions,
    createStep,
    setCreateStep,
    createDraftLabel,
    selectedColorIndex,
    setSelectedColorIndex,
    selectedScopeIndex,
    setSelectedScopeIndex,
    creating: () => addOption.isPending || ensureTagSet.isPending,
    beginCreate,
    beginEdit,
    openTaggedItems,
    createTag,
    dropdown,
    setScrollContainer: (element: HTMLDivElement) => {
      scrollContainerRef = element;
    },
  };
}

export type TagPickerSession = ReturnType<typeof createTagPickerSession>;
