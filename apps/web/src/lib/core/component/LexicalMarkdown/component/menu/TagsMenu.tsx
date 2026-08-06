import { type PortalScope, ScopedPortal } from '@core/component/ScopedPortal';
import clickOutside from '@core/directive/clickOutside';
import PlusIcon from '@phosphor/plus.svg';
import { TagDot } from '@property/tags/TagDot';
import { DEFAULT_TAG_COLOR, type TAG_COLORS } from '@property/tags/tagColors';
import { useAddPropertyOptionMutation } from '@queries/properties/options';
import {
  invalidateTags,
  useEnsureTagSetMutation,
  useTagsQuery,
} from '@queries/properties/tags';
import { useCurrentTeamQuery } from '@queries/team/teams';
import type { PropertyOptionResponse } from '@service-properties/generated/schemas/propertyOptionResponse';
import type { TagScope } from '@service-properties/generated/schemas/tagScope';
import { Surface } from '@ui';
import type { LexicalEditor } from 'lexical';
import {
  createEffect,
  createMemo,
  createSignal,
  For,
  type JSX,
  onCleanup,
  onMount,
  Show,
} from 'solid-js';
import { floatWithSelection } from '../../directive/floatWithSelection';
import {
  CLOSE_INLINE_SEARCH_COMMAND,
  REMOVE_INLINE_SEARCH_COMMAND,
} from '../../plugins';
import type { TagMentionLifecycle } from '../../plugins/tags';
import { INSERT_TAG_MENTION_COMMAND } from '../../plugins/tags';
import type { MenuOperations } from '../../shared/inlineMenu';
import { InlineFollowupMenu } from './InlineFollowupMenu';
import { useMenuKeyboardNavigation } from './useMenuKeyboardNavigation';

type TagMenuItem = {
  optionId: string;
  propertyDefinitionId: string;
  scope: 'user' | 'team';
  name: string;
  color?: string;
};

type CreateStep = 'color' | 'scope';

type PendingTagCreate = {
  scope: TagScope;
  value: string;
  color: string;
};

const TAG_COLOR_OPTIONS = [
  { color: '#E5484D', name: 'Red' },
  { color: '#E54D2E', name: 'Tomato' },
  { color: '#F76B15', name: 'Orange' },
  { color: '#FFB224', name: 'Amber' },
  { color: '#F5D90A', name: 'Yellow' },
  { color: '#46A758', name: 'Green' },
  { color: '#12A594', name: 'Teal' },
  { color: '#0091FF', name: 'Blue' },
  { color: '#3E63DD', name: 'Indigo' },
  { color: '#8E4EC6', name: 'Purple' },
  { color: '#E93D82', name: 'Pink' },
  { color: '#889096', name: 'Gray' },
] as const satisfies readonly {
  color: (typeof TAG_COLORS)[number];
  name: string;
}[];

const FOLLOWUP_MENU_OPEN_DELAY_MS = 40;

function optionLabel(value: unknown): string | undefined {
  if (
    typeof value === 'object' &&
    value !== null &&
    'type' in value &&
    value.type === 'string' &&
    'value' in value &&
    typeof value.value === 'string'
  ) {
    return value.value;
  }
  return undefined;
}

function nextDisplayOrder(options: PropertyOptionResponse[]): number {
  return (
    options.reduce((max, option) => Math.max(max, option.displayOrder), -1) + 1
  );
}

function ScrollIntoViewOnSelect(props: {
  selected: boolean;
  children: JSX.Element;
}) {
  let ref: HTMLDivElement | undefined;

  createEffect(() => {
    if (props.selected && ref) {
      ref.scrollIntoView({ block: 'nearest' });
    }
  });

  return <div ref={ref}>{props.children}</div>;
}

export function TagsMenu(props: {
  editor: LexicalEditor;
  menu: MenuOperations;
  portalScope?: PortalScope;
  useBlockBoundary?: boolean;
  applyTargetLabel?: string;
  isApplied?: (tag: TagMentionLifecycle) => boolean;
  onApplyTag?: (tag: TagMentionLifecycle) => void;
}) {
  const tagsQuery = useTagsQuery();
  const currentTeamQuery = useCurrentTeamQuery();
  const addOption = useAddPropertyOptionMutation();
  const ensureTagSet = useEnsureTagSetMutation();
  const [mountSelection, setMountSelection] = createSignal<Selection | null>();
  const [menuAvailableHeight, setMenuAvailableHeight] = createSignal<
    number | undefined
  >();
  const [selectedIndex, setSelectedIndex] = createSignal(0);
  const [createStep, setCreateStep] = createSignal<CreateStep | null>(null);
  const [createDraftLabel, setCreateDraftLabel] = createSignal('');
  const [selectedColorIndex, setSelectedColorIndex] = createSignal(0);
  const [selectedScopeIndex, setSelectedScopeIndex] = createSignal(0);
  const [pendingCreate, setPendingCreate] =
    createSignal<PendingTagCreate | null>(null);
  const [pendingApplyTag, setPendingApplyTag] =
    createSignal<TagMentionLifecycle | null>(null);
  const [applyPromptSelection, setApplyPromptSelection] =
    createSignal<Selection | null>(null);
  const [applyPromptSelectedIndex, setApplyPromptSelectedIndex] =
    createSignal(0);
  let applyPromptOpenTimeout: ReturnType<typeof setTimeout> | undefined;

  const items = createMemo<TagMenuItem[]>(() => {
    const query = props.menu.searchTerm().trim().toLowerCase();
    return (tagsQuery.data ?? [])
      .flatMap((set) =>
        set.options.map((option) => ({
          optionId: option.id,
          propertyDefinitionId: option.propertyDefinitionId,
          scope: set.scope,
          name: optionLabel(option.value) ?? option.id,
          color: option.color ?? undefined,
        }))
      )
      .filter((tag) => !query || tag.name.toLowerCase().includes(query))
      .sort((a, b) => a.name.localeCompare(b.name));
  });

  const allItems = createMemo<TagMenuItem[]>(() =>
    (tagsQuery.data ?? []).flatMap((set) =>
      set.options.map((option) => ({
        optionId: option.id,
        propertyDefinitionId: option.propertyDefinitionId,
        scope: set.scope,
        name: optionLabel(option.value) ?? option.id,
        color: option.color ?? undefined,
      }))
    )
  );
  const createLabel = () => props.menu.searchTerm().trim();
  const exactTagMatchExists = () => {
    const label = createLabel().toLowerCase();
    return (
      !!label && allItems().some((tag) => tag.name.toLowerCase() === label)
    );
  };
  const showCreateRow = () =>
    createLabel().length >= 2 && !exactTagMatchExists();
  const createRowIndex = () => items().length;
  const itemCount = () => items().length + (showCreateRow() ? 1 : 0);
  const teamName = () => currentTeamQuery.data?.team.name?.trim() || 'Team';
  const scopeOptions = createMemo<{ scope: TagScope; label: string }[]>(() => [
    { scope: 'team', label: `Shared with ${teamName()}` },
    { scope: 'user', label: 'Personal' },
  ]);
  const createStepCount = () =>
    createStep() === 'color' ? TAG_COLOR_OPTIONS.length : scopeOptions().length;
  const selectedColor = () =>
    TAG_COLOR_OPTIONS[selectedColorIndex()]?.color ?? DEFAULT_TAG_COLOR;

  createEffect(() => {
    if (props.menu.isOpen()) {
      setMountSelection(document.getSelection());
      if (!pendingApplyTag()) setSelectedIndex(0);
    } else {
      setMountSelection(null);
      setCreateStep(null);
      props.menu.setSearchTerm('');
    }
  });

  createEffect(() => {
    const count = itemCount();
    if (selectedIndex() >= count) setSelectedIndex(Math.max(0, count - 1));
  });

  const closeMenu = () => {
    if (applyPromptOpenTimeout) {
      clearTimeout(applyPromptOpenTimeout);
      applyPromptOpenTimeout = undefined;
    }
    props.editor.dispatchCommand(CLOSE_INLINE_SEARCH_COMMAND, undefined);
    setPendingApplyTag(null);
    setApplyPromptSelection(null);
    props.menu.setIsOpen(false);
  };

  const selectItem = (item: TagMenuItem | undefined) => {
    if (!item) {
      closeMenu();
      return;
    }
    props.editor.dispatchCommand(REMOVE_INLINE_SEARCH_COMMAND, undefined);
    props.editor.dispatchCommand(INSERT_TAG_MENTION_COMMAND, item);
    setCreateStep(null);
    props.menu.setSearchTerm('');

    const alreadyApplied = props.isApplied?.(item) ?? false;
    if (props.applyTargetLabel && props.onApplyTag && !alreadyApplied) {
      props.menu.setIsOpen(false);
      if (applyPromptOpenTimeout) clearTimeout(applyPromptOpenTimeout);
      applyPromptOpenTimeout = setTimeout(() => {
        applyPromptOpenTimeout = undefined;
        setApplyPromptSelection(document.getSelection());
        setPendingApplyTag(item);
        setApplyPromptSelectedIndex(0);
      }, FOLLOWUP_MENU_OPEN_DELAY_MS);
      return;
    }

    props.menu.setIsOpen(false);
  };

  const applyPendingTag = () => {
    const tag = pendingApplyTag();
    if (!tag) return;
    props.onApplyTag?.(tag);
    closeMenu();
  };

  const beginCreate = () => {
    const label = createLabel();
    if (!showCreateRow() || !label) return;
    setCreateDraftLabel(label);
    setSelectedColorIndex(0);
    setSelectedScopeIndex(0);
    setCreateStep('color');
  };

  const selectCurrent = () => {
    if (showCreateRow() && selectedIndex() === createRowIndex()) {
      beginCreate();
      return;
    }
    selectItem(items()[selectedIndex()]);
  };

  const createTag = async (scope: TagScope) => {
    const value = createDraftLabel().trim();
    if (!value) return;
    if (pendingCreate()) return;

    const creation: PendingTagCreate = {
      scope,
      value,
      color: selectedColor(),
    };
    setPendingCreate(creation);

    try {
      const provisioned = await ensureTagSet.mutateAsync({ scope });
      if (!provisioned.definition) return;

      const created = await addOption.mutateAsync({
        propertyDefinitionId: provisioned.definition.id,
        body: {
          type: 'select_string',
          option: {
            value,
            display_order: nextDisplayOrder(provisioned.options),
            color: creation.color,
          },
        },
      });
      invalidateTags();
      if (
        pendingCreate() !== creation ||
        !props.menu.isOpen() ||
        createStep() !== 'scope' ||
        scopeOptions()[selectedScopeIndex()]?.scope !== scope ||
        createDraftLabel().trim() !== value
      ) {
        return;
      }
      selectItem({
        optionId: created.id,
        propertyDefinitionId: created.property_definition_id,
        scope,
        name: value,
        color: created.color ?? creation.color,
      });
    } catch (error) {
      console.error('Failed to create tag', error);
    } finally {
      if (pendingCreate() === creation) {
        setPendingCreate(null);
      }
    }
  };

  const createStepUp = () => {
    const count = createStepCount();
    if (count === 0) return;
    if (createStep() === 'color') {
      setSelectedColorIndex((prev) => (prev - 1 + count) % count);
    } else {
      setSelectedScopeIndex((prev) => (prev - 1 + count) % count);
    }
  };

  const createStepDown = () => {
    const count = createStepCount();
    if (count === 0) return;
    if (createStep() === 'color') {
      setSelectedColorIndex((prev) => (prev + 1) % count);
    } else {
      setSelectedScopeIndex((prev) => (prev + 1) % count);
    }
  };

  const selectCreateStep = () => {
    if (createStep() === 'color') {
      setCreateStep('scope');
      return;
    }
    const scope = scopeOptions()[selectedScopeIndex()]?.scope;
    if (scope) void createTag(scope);
  };

  useMenuKeyboardNavigation({
    isActive: props.menu.isOpen,
    onUp: () => {
      if (createStep()) {
        createStepUp();
        return;
      }
      const count = itemCount();
      if (count === 0) return;
      setSelectedIndex((prev) => (prev - 1 + count) % count);
    },
    onDown: () => {
      if (createStep()) {
        createStepDown();
        return;
      }
      const count = itemCount();
      if (count === 0) return;
      setSelectedIndex((prev) => (prev + 1) % count);
    },
    onSelect: () => {
      if (createStep()) {
        selectCreateStep();
      } else {
        selectCurrent();
      }
    },
    onClose: closeMenu,
    onSpace: () => {
      if (!createStep() && props.menu.searchTerm() === '') {
        closeMenu();
        return false;
      }
      return !!createStep();
    },
  });

  const focusOut = () => {
    if (applyPromptOpenTimeout) {
      return;
    }
    if (pendingApplyTag()) return;
    closeMenu();
  };

  onMount(() => {
    document.addEventListener('focusout', focusOut);
    onCleanup(() => {
      if (applyPromptOpenTimeout) clearTimeout(applyPromptOpenTimeout);
      document.removeEventListener('focusout', focusOut);
    });
  });

  const contentMaxHeight = () => {
    const h = menuAvailableHeight();
    if (h === undefined) return '16rem';
    return `${Math.min(256, Math.max(0, h - 18))}px`;
  };

  return (
    <>
      <Show when={props.menu.isOpen()}>
        <ScopedPortal scope={props.portalScope}>
          <div
            class="w-64 max-w-[calc(100cqw-1rem-2px)] cursor-default select-none z-modal-content menu-open-animation"
            ref={(el) => {
              floatWithSelection(el, () => ({
                selection: mountSelection(),
                reactiveOnContainer: props.editor.getRootElement(),
                useBlockBoundary: props.useBlockBoundary,
                onAvailableHeight: setMenuAvailableHeight,
              }));
              clickOutside(el, () => () => closeMenu());
            }}
          >
            <Surface
              depth={2}
              class="py-1.5 shadow-lg shadow-drop-shadow rounded-xl"
            >
              <Show
                when={createStep()}
                fallback={
                  <Show
                    when={items().length > 0 || showCreateRow()}
                    fallback={
                      <div class="px-3 py-1 text-ink-extra-muted">No tags</div>
                    }
                  >
                    <TagMenuItems
                      items={items()}
                      selectedIndex={selectedIndex()}
                      createRowIndex={createRowIndex()}
                      showCreateRow={showCreateRow()}
                      createLabel={createLabel()}
                      teamName={teamName()}
                      contentMaxHeight={contentMaxHeight()}
                      onItemMouseEnter={setSelectedIndex}
                      onItemSelect={selectItem}
                      onCreateMouseEnter={() =>
                        setSelectedIndex(createRowIndex())
                      }
                      onCreateSelect={beginCreate}
                    />
                  </Show>
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
            </Surface>
          </div>
        </ScopedPortal>
      </Show>
      <InlineFollowupMenu
        editor={props.editor}
        open={pendingApplyTag() !== null}
        selection={applyPromptSelection()}
        portalScope={props.portalScope}
        useBlockBoundary={props.useBlockBoundary}
        selectedIndex={applyPromptSelectedIndex()}
        onSelectedIndexChange={setApplyPromptSelectedIndex}
        onClose={closeMenu}
        options={[
          {
            id: 'apply-tag',
            label: <>Add tag to {props.applyTargetLabel ?? ''}</>,
            hotkey: 'enter',
            onSelect: applyPendingTag,
          },
        ]}
      />
    </>
  );
}

function TagMenuItems(props: {
  items: TagMenuItem[];
  selectedIndex: number;
  createRowIndex: number;
  showCreateRow: boolean;
  createLabel: string;
  teamName: string;
  contentMaxHeight: string;
  onItemMouseEnter: (index: number) => void;
  onItemSelect: (item: TagMenuItem) => void;
  onCreateMouseEnter: () => void;
  onCreateSelect: () => void;
}) {
  return (
    <div
      class="overflow-y-auto scrollbar-hidden"
      style={{ 'max-height': props.contentMaxHeight }}
    >
      <For each={props.items}>
        {(item, index) => (
          <ScrollIntoViewOnSelect selected={props.selectedIndex === index()}>
            <button
              type="button"
              class="w-[calc(100%-0.75rem)] flex items-center gap-2 px-2 py-1.5 mx-1.5 text-left text-sm rounded-lg"
              classList={{
                'bg-hover': props.selectedIndex === index(),
              }}
              onMouseEnter={() => props.onItemMouseEnter(index())}
              onMouseDown={(event) => {
                event.preventDefault();
                event.stopPropagation();
              }}
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                props.onItemSelect(item);
              }}
            >
              <TagDot color={item.color} />
              <span class="min-w-0 flex-1 truncate">{item.name}</span>
              <Show when={item.scope === 'team'}>
                <span class="max-w-20 shrink-0 truncate rounded-full border border-ink/5 px-1.5 py-0.5 text-[10px] leading-none text-ink-extra-muted">
                  {props.teamName}
                </span>
              </Show>
            </button>
          </ScrollIntoViewOnSelect>
        )}
      </For>
      <Show when={props.showCreateRow}>
        <ScrollIntoViewOnSelect
          selected={props.selectedIndex === props.createRowIndex}
        >
          <button
            type="button"
            class="w-[calc(100%-0.75rem)] flex items-center gap-2 px-2 py-1.5 mx-1.5 text-left text-sm rounded-lg"
            classList={{
              'bg-hover': props.selectedIndex === props.createRowIndex,
            }}
            onMouseEnter={props.onCreateMouseEnter}
            onMouseDown={(event) => {
              event.preventDefault();
              event.stopPropagation();
            }}
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              props.onCreateSelect();
            }}
          >
            <PlusIcon class="size-3 shrink-0 text-ink-muted" />
            <span class="min-w-0 truncate">
              Create tag "{props.createLabel}"
            </span>
          </button>
        </ScrollIntoViewOnSelect>
      </Show>
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
              <ScrollIntoViewOnSelect
                selected={props.selectedScopeIndex === index()}
              >
                <button
                  type="button"
                  class="w-[calc(100%-0.75rem)] flex items-center gap-2 px-2 py-1.5 mx-1.5 text-left text-sm rounded-lg"
                  classList={{
                    'bg-hover': props.selectedScopeIndex === index(),
                  }}
                  onMouseEnter={() => props.onScopeMouseEnter(index())}
                  onMouseDown={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                  }}
                  onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    props.onScopeSelect(option.scope);
                  }}
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
                    <span class="shrink-0 text-xs text-ink-muted">
                      Creating...
                    </span>
                  </Show>
                </button>
              </ScrollIntoViewOnSelect>
            )}
          </For>
        }
      >
        <For each={props.colorOptions}>
          {(option, index) => (
            <ScrollIntoViewOnSelect
              selected={props.selectedColorIndex === index()}
            >
              <button
                type="button"
                class="w-[calc(100%-0.75rem)] flex items-center gap-2 px-2 py-1.5 mx-1.5 text-left text-sm rounded-lg"
                classList={{
                  'bg-hover': props.selectedColorIndex === index(),
                }}
                onMouseEnter={() => props.onColorMouseEnter(index())}
                onMouseDown={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                }}
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  props.onColorSelect(index());
                }}
              >
                <TagDot color={option.color} />
                <span class="min-w-0 flex-1 truncate">{option.name}</span>
              </button>
            </ScrollIntoViewOnSelect>
          )}
        </For>
      </Show>
    </div>
  );
}
