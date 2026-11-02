import { PickerSheet } from '@components/app/mobile/PickerSheet';
import { virtualKeyboardVisible } from '@core/mobile/virtualKeyboard';
import { fireAndForget } from '@core/util/fireAndForget';
import CircleDashedEmpty from '@icon/system/regular/circle-dashed.svg';
import FilterIcon from '@icon/system/regular/funnel-simple.svg';
import PencilIcon from '@icon/system/regular/pencil-simple.svg';
import PlusIcon from '@icon/system/regular/plus.svg';
import { Popover } from '@kobalte/core/popover';
import { OptionCheckBox } from '@property/editors/selectors/OptionCheckBox';
import {
  DropdownSearchInput,
  DropdownSelectableRow,
} from '@property/editors/selectors/PropertyOptionSelector';
import { useSearchInputFocus } from '@property/utils';
import { useCurrentTeamQuery } from '@queries/team/teams';
import type { TagScope } from '@service-properties/generated/schemas/tagScope';
import { Button, cn, Layer } from '@ui';
import {
  createEffect,
  createSignal,
  For,
  type JSX,
  on,
  onCleanup,
  onMount,
  Show,
} from 'solid-js';
import { TagDot } from './TagDot';
import { TagEditorDialog, type TagEditorDialogMode } from './TagEditorDialog';
import {
  type CreateStep,
  type CreateTagSuccessHandler,
  createTagPickerSession,
  type DocTags,
  optionLabel,
  type TagOptionItem,
  type TagPickerSession,
} from './tag-picker-session';
import { DEFAULT_TAG_COLOR, TAG_COLOR_OPTIONS } from './tagColors';
import type { ResolvedTag } from './useDocTags';

const MAX_LIST_HEIGHT = 192;
// The keyboard covers the layout viewport's bottom without shrinking it, so
// flipping cannot see it: a picker opened low on a phone hides behind it.
const pickerPlacement = () =>
  virtualKeyboardVisible() ? 'top-start' : 'bottom-start';
const tagActionButtonClass =
  'size-5 shrink-0 p-0.5 text-ink-extra-muted opacity-0 group-hover:opacity-100 focus-visible:opacity-100 touch:opacity-100';

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
   * Fires when a picker session starts or ends, where a session covers both the
   * popover and the tag editor dialog it can hand off to. Consumers that
   * unmount the trigger once the picker is done (a chip that disappears with
   * its last tag, say) should wait for this instead of `onOpenChange`, which
   * reports closed while the editor dialog is still up.
   */
  onActiveChange?: (active: boolean) => void;
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

  const pickerActive = () => open() || editorMode() !== null;
  createEffect(
    on(pickerActive, (active) => props.onActiveChange?.(active), {
      defer: true,
    })
  );

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
      fireAndForget(saveAndClose(), 'tag-picker');
    } else {
      setOpenState(false, { restoreFocus: true });
    }
  };

  return (
    <Popover
      open={open()}
      onOpenChange={handleOpenChange}
      placement={pickerPlacement()}
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
      fireAndForget(saveAndClose(), 'tag-picker');
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
        placement={pickerPlacement()}
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

/**
 * The tag picker for a touch sheet: its trigger opens the picker in a sheet
 * stacked over the current one, with Cancel, the Tags title, and Done. Picks
 * stay staged until Done; Cancel, the backdrop, or Escape drop them.
 */
export function TagSheetPicker(props: {
  docTags: DocTags;
  triggerClass?: string;
  triggerLabel: string;
  children: JSX.Element;
  /** As `TagPicker`'s: a session covers the sheet and the tag editor it opens. */
  onActiveChange?: (active: boolean) => void;
}) {
  const [open, setOpen] = createSignal(false);
  const [editorMode, setEditorMode] = createSignal<TagEditorDialogMode | null>(
    null
  );
  const currentTeamQuery = useCurrentTeamQuery();
  createEffect(
    on(
      () => open() || editorMode() !== null,
      (active) => props.onActiveChange?.(active),
      { defer: true }
    )
  );

  return (
    <>
      <button
        type="button"
        class={props.triggerClass}
        aria-label={props.triggerLabel}
        aria-haspopup="dialog"
        aria-expanded={open()}
        onClick={() => setOpen(true)}
      >
        {props.children}
      </button>
      <PickerSheet.Root open={open()} onCancel={() => setOpen(false)}>
        <TagPickerSheetBody
          docTags={props.docTags}
          onClose={() => setOpen(false)}
          onOpenEditEditor={(mode) => {
            setEditorMode(mode);
            setOpen(false);
          }}
        />
      </PickerSheet.Root>
      <Show when={editorMode()}>
        <TagEditorDialog
          open
          mode={editorMode()}
          teamAvailable={Boolean(currentTeamQuery.data?.team)}
          onClose={() => setEditorMode(null)}
        />
      </Show>
    </>
  );
}

function TagPickerSheetBody(props: {
  docTags: DocTags;
  onClose: () => void;
  onOpenEditEditor: (
    mode: Extract<TagEditorDialogMode, { type: 'edit' }>
  ) => void;
}) {
  const session = createTagPickerSession({
    docTags: props.docTags,
    onClose: props.onClose,
    onOpenEditEditor: props.onOpenEditEditor,
    confirmsWithDone: true,
  });
  return (
    <>
      <PickerSheet.Header
        title="Tags"
        onDone={() => fireAndForget(session.saveAndClose(), 'tag-picker')}
      />
      <PickerSheet.Body>
        <TagPickerList session={session} fillHeight />
      </PickerSheet.Body>
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
  const session = createTagPickerSession({
    docTags: props.docTags,
    onClose: props.onClose,
    onOpenEditEditor: props.onOpenEditEditor,
    confirmsWithDone: false,
  });
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

  onMount(() => {
    props.registerSave(session.saveAndClose);
    const timeout = setTimeout(() => {
      setInitialOutsideEventGuard(false);
    }, 100);
    onCleanup(() => clearTimeout(timeout));
  });

  onCleanup(() => {
    props.registerSave(undefined);
  });

  return (
    <Popover.Portal>
      <Layer depth={3}>
        <Popover.Content
          class="menu-surface z-modal w-96 max-w-[min(24rem,calc(100vw-1.5rem))] text-sm menu-open-animation"
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
          <TagPickerList session={session} />
        </Popover.Content>
      </Layer>
    </Popover.Portal>
  );
}

/** The search, tag rows, and create flow of a picker session. */
function TagPickerList(props: {
  session: TagPickerSession;
  /** Fill a sized container, such as a sheet, rather than a popover's height. */
  fillHeight?: boolean;
}) {
  const session = props.session;
  const rowProps = (item: TagOptionItem) => ({
    item,
    index: session.itemIndex(item),
    teamName: session.teamName(),
    checked: session.isSelected(item.option.id),
    selected: session.dropdown.selectedIndex() === session.itemIndex(item),
    onSelect: (event: MouseEvent) => session.pick(item, event),
    onEdit: () => fireAndForget(session.beginEdit(item), 'tag-picker'),
    onOpenTag: () => fireAndForget(session.openTaggedItems(item), 'tag-picker'),
    onMouseEnter: () => {
      if (!session.dropdown.keyboardMode()) {
        session.dropdown.setSelectedIndex(session.itemIndex(item));
      }
    },
  });
  // Picking a row keeps focus in the search field, so a phone keyboard stays
  // up; iOS devices still send mousedown after a cancelled pointerdown.
  const keepSearchFocus = (event: Event) => event.preventDefault();
  let searchInput: HTMLInputElement | undefined;
  useSearchInputFocus(() => searchInput);

  return (
    <Show
      when={session.createStep()}
      fallback={
        <>
          <DropdownSearchInput
            value={session.search()}
            placeholder="Change or add tags"
            onInput={session.setSearch}
            inputRef={(element) => {
              searchInput = element;
            }}
          />
          <div
            class={cn(
              'p-1.5',
              props.fillHeight && 'flex min-h-0 flex-1 flex-col'
            )}
            onPointerDown={keepSearchFocus}
            onMouseDown={keepSearchFocus}
          >
            <div
              ref={session.setScrollContainer}
              class={cn(
                'overflow-y-auto overflow-x-hidden scrollbar-hidden',
                props.fillHeight && 'min-h-0 flex-1'
              )}
              style={{
                'max-height': props.fillHeight
                  ? undefined
                  : `${MAX_LIST_HEIGHT}px`,
              }}
            >
              <Show
                when={
                  session.showClearAllRow() ||
                  session.filteredItems().length > 0 ||
                  session.showCreateRow()
                }
                fallback={
                  <div class="px-2 py-4 text-center text-ink-muted">
                    {session.hasTags()
                      ? 'No tags match your search'
                      : 'No tags available'}
                  </div>
                }
              >
                <For each={session.selectedAtOpenItems()}>
                  {(item) => <TagPickerRow {...rowProps(item)} />}
                </For>
                <Show
                  when={
                    session.selectedAtOpenItems().length > 0 &&
                    (session.remainingItemsForScope('user').length > 0 ||
                      session.remainingItemsForScope('team').length > 0)
                  }
                >
                  <div class="my-1 border-t border-edge-muted" />
                </Show>
                <For each={['user', 'team'] as const}>
                  {(scope) => (
                    <For each={session.remainingItemsForScope(scope)}>
                      {(item) => <TagPickerRow {...rowProps(item)} />}
                    </For>
                  )}
                </For>
                <Show when={session.showClearAllRow()}>
                  <div class="my-1 border-t border-edge-muted" />
                  <div data-tag-index={session.clearAllRowIndex()}>
                    <DropdownSelectableRow
                      isSelected={
                        session.dropdown.selectedIndex() ===
                        session.clearAllRowIndex()
                      }
                      onClick={session.clearAll}
                      onMouseEnter={() => {
                        if (!session.dropdown.keyboardMode()) {
                          session.dropdown.setSelectedIndex(
                            session.clearAllRowIndex()
                          );
                        }
                      }}
                    >
                      <CircleDashedEmpty class="size-3 shrink-0 text-ink-extra-muted" />
                      <div class="min-w-0 flex-1 text-left">
                        <p class="truncate text-ink-muted">Clear all tags</p>
                      </div>
                    </DropdownSelectableRow>
                  </div>
                </Show>
              </Show>
            </div>
            <Show when={session.showCreateRow()}>
              <div
                classList={{
                  'mt-1 border-t border-edge-muted pt-1':
                    session.showCreateRowDivider(),
                }}
              >
                <CreateTagRow
                  index={session.createRowIndex()}
                  label={session.createLabel()}
                  selected={
                    session.dropdown.selectedIndex() ===
                    session.createRowIndex()
                  }
                  onClick={session.beginCreate}
                  onMouseEnter={() => {
                    if (!session.dropdown.keyboardMode()) {
                      session.dropdown.setSelectedIndex(
                        session.createRowIndex()
                      );
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
          label={session.createDraftLabel()}
          colorOptions={TAG_COLOR_OPTIONS}
          selectedColorIndex={session.selectedColorIndex()}
          scopeOptions={session.scopeOptions()}
          selectedScopeIndex={session.selectedScopeIndex()}
          pending={session.creating()}
          onColorMouseEnter={session.setSelectedColorIndex}
          onColorSelect={(index) => {
            session.setSelectedColorIndex(index);
            session.setCreateStep('scope');
          }}
          onScopeMouseEnter={session.setSelectedScopeIndex}
          onScopeSelect={(scope) =>
            fireAndForget(session.createTag(scope), 'tag-picker')
          }
        />
      )}
    </Show>
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
