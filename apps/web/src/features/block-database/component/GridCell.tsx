import { createFocusManager } from '@kobalte/utils';
import CaretDownIcon from '@phosphor/caret-down.svg';
import CheckIcon from '@phosphor/check.svg';
import PlusIcon from '@phosphor/plus.svg';
import { Dropdown } from '@ui/components/Dropdown';
import {
  createSignal,
  For,
  type JSX,
  onCleanup,
  onMount,
  Show,
} from 'solid-js';
import { SelectPill } from '../components/select-pill';
import type {
  DatabaseEntityType,
  DatabaseMention,
} from '../core/column-inference';
import type {
  DatabaseCellValue,
  DatabaseViewColumn,
} from '../core/database-view';
import { canEditCell, formatCellValue } from '../core/table';

export type GridCellControl = {
  focus: () => void;
  edit: (seed?: string) => void;
};

export type GridCellEditorOptions = {
  initialEdit?: boolean;
  onEditorReady?: (focus: () => void) => void;
  onReady?: (control: GridCellControl | undefined) => void;
  onNavigate?: (direction: 1 | -1) => boolean;
};

export type DatabaseMentionPickerProps = {
  anchor?: HTMLElement;
  specificEntityType?: DatabaseEntityType;
  value: string | null;
  search: string;
  onSearchChange?: (search: string) => void;
  onSelect: (mention: DatabaseMention, direction?: 1 | -1) => void;
  onClose: (restoreFocus?: boolean) => void;
};

export type GridCellProps = GridCellEditorOptions & {
  column: DatabaseViewColumn;
  value: DatabaseCellValue;
  emptyLabel?: string;
  canEdit: boolean;
  renderMentionPicker?: (props: DatabaseMentionPickerProps) => JSX.Element;
  renderMentionValue?: (id: string, type: DatabaseEntityType) => JSX.Element;
  onMention?: (mention: DatabaseMention) => Promise<boolean>;
  onWrite: (value: DatabaseCellValue) => Promise<boolean>;
  onAddOption: (label: string) => Promise<boolean>;
};

/** A presentational cell. Writes, including new options, belong to its table controller. */
export function GridCell(props: GridCellProps) {
  const isEntity = () =>
    props.column.dataType === 'ENTITY' && !props.column.isMultiSelect;
  const editable = () =>
    props.canEdit &&
    canEditCell(props.column) &&
    (!isEntity() || (!!props.renderMentionPicker && !!props.onMention));
  const mentionsEnabled = () =>
    editable() &&
    !!props.renderMentionPicker &&
    !!props.onMention &&
    (isEntity() ||
      (props.column.dataType === 'STRING' && !!props.column.inferType));
  const [mentionOpen, setMentionOpen] = createSignal(false);
  const [mentionSearch, setMentionSearch] = createSignal('');
  const [selectedMention, setSelectedMention] = createSignal<{
    mention: DatabaseMention;
    originalValue: DatabaseCellValue;
  }>();
  const mentionPreview = () => {
    const preview = selectedMention();
    if (
      !preview ||
      (props.value !== preview.mention.id &&
        props.value !== preview.originalValue) ||
      (props.value === preview.mention.id &&
        isEntity() &&
        props.column.specificEntityType === preview.mention.entityType &&
        props.renderMentionValue)
    )
      return undefined;
    return preview;
  };
  const hasResolvedMentionLabel = () =>
    isEntity() && props.value !== null && !mentionPreview();
  let cell: HTMLDivElement | undefined;
  const isSelect = () =>
    !props.column.isMultiSelect &&
    ['SELECT_STRING', 'SELECT_NUMBER'].includes(props.column.dataType);
  const startsEditing = Boolean(
    props.initialEdit && editable() && props.column.dataType === 'STRING'
  );
  const [editing, setEditing] = createSignal(startsEditing);
  const [draft, setDraft] = createSignal(
    startsEditing && props.value !== null ? String(props.value) : ''
  );
  const [selectAll, setSelectAll] = createSignal(true);
  let trigger: HTMLElement | undefined;
  let booleanWrapper: HTMLDivElement | undefined;
  let focusEditor: (() => void) | undefined;
  let selectControl: GridCellControl | undefined;
  const beginEdit = (seed?: string) => {
    if (!editable()) return;
    setSelectedMention(undefined);
    if (isEntity()) {
      setMentionSearch(seed?.replace(/^@/, '') ?? '');
      setMentionOpen(true);
      return;
    }
    setSelectAll(seed === undefined);
    setDraft(
      seed !== undefined
        ? seed
        : props.value === null
          ? ''
          : props.column.dataType === 'DATE'
            ? String(props.value).slice(0, 10)
            : String(props.value)
    );
    setEditing(true);
    if (mentionsEnabled() && draft().startsWith('@')) {
      setMentionSearch(draft().slice(1));
      setMentionOpen(true);
    }
  };
  const updateDraft = (value: string) => {
    setDraft(value);
    if (mentionsEnabled() && value.startsWith('@')) {
      setMentionSearch(value.slice(1));
      setMentionOpen(true);
    }
  };
  const closeMention = (restoreFocus = true) => {
    setMentionOpen(false);
    if (restoreFocus)
      queueMicrotask(() => (editing() ? focusEditor?.() : trigger?.focus()));
  };
  const selectMention = (mention: DatabaseMention, direction?: 1 | -1) => {
    if (!mentionsEnabled()) return;
    const preview = {
      mention,
      originalValue: props.value,
    };
    setSelectedMention(preview);
    setEditing(false);
    setMentionOpen(false);
    void props.onMention?.(mention).then(() => {
      setSelectedMention((current) => {
        if (current !== preview) return current;
        if (props.value !== preview.originalValue && props.value !== mention.id)
          return undefined;
        return { mention, originalValue: props.value };
      });
    });
    if (direction && props.onNavigate?.(direction)) return;
    queueMicrotask(() => {
      if (direction) focusAdjacent(trigger, direction);
      else trigger?.focus();
    });
  };
  const finishEdit = (restoreFocus = true) => {
    setEditing(false);
    if (restoreFocus) queueMicrotask(() => trigger?.focus());
  };
  onMount(() =>
    props.onReady?.({
      focus: () => {
        if (editing()) focusEditor?.();
        else if (isSelect() && selectControl) selectControl.focus();
        else if (
          props.column.dataType === 'BOOLEAN' &&
          !props.column.isMultiSelect &&
          !editable()
        )
          booleanWrapper?.focus();
        else trigger?.focus();
      },
      edit: (seed) => {
        if (!editable()) return;
        if (isSelect()) selectControl?.edit(seed);
        else if (props.column.dataType === 'BOOLEAN') trigger?.focus();
        else if (editing()) focusEditor?.();
        else beginEdit(seed);
      },
    })
  );
  onCleanup(() => props.onReady?.(undefined));
  const navigate = (event: KeyboardEvent) => {
    if (event.key === 'Tab' && props.onNavigate?.(event.shiftKey ? -1 : 1)) {
      event.preventDefault();
      event.stopPropagation();
    }
  };

  return (
    <div ref={cell} class="relative min-w-0">
      <Show
        when={editing()}
        fallback={
          <Show
            when={
              props.column.dataType === 'BOOLEAN' && !props.column.isMultiSelect
            }
            fallback={
              <Show
                when={isSelect()}
                fallback={
                  <button
                    ref={(element) => {
                      trigger = element;
                    }}
                    type="button"
                    class="flex min-h-9 w-full min-w-0 items-center rounded px-2.5 py-1.5 text-left text-[13px] leading-5 outline-none hover:bg-hover focus-visible:ring-2 focus-visible:ring-ink/50"
                    classList={{
                      'text-ink-muted': !editable(),
                      'text-ink-placeholder':
                        props.value === null && !mentionPreview(),
                      'font-medium': props.column.dataType === 'STRING',
                    }}
                    aria-label={
                      hasResolvedMentionLabel()
                        ? undefined
                        : `${props.column.name}: ${mentionPreview()?.mention.label || formatCellValue(props.column, props.value) || props.emptyLabel || 'Empty'}${editable() ? '. Click to edit' : ''}`
                    }
                    aria-description={
                      hasResolvedMentionLabel() && editable()
                        ? 'Click to edit'
                        : undefined
                    }
                    aria-readonly={!editable()}
                    title={
                      mentionPreview()?.mention.label ||
                      (!isEntity() &&
                        formatCellValue(props.column, props.value)) ||
                      undefined
                    }
                    onClick={() => editable() && beginEdit()}
                    onKeyDown={(event) => {
                      if (!editable()) return;
                      if (event.isComposing || event.keyCode === 229) {
                        beginEdit('');
                        return;
                      }
                      navigate(event);
                      if (
                        event.defaultPrevented ||
                        event.metaKey ||
                        event.ctrlKey ||
                        event.altKey
                      )
                        return;
                      if (
                        isEntity() &&
                        (event.key === 'Backspace' || event.key === 'Delete')
                      ) {
                        event.preventDefault();
                        event.stopPropagation();
                        setSelectedMention(undefined);
                        void props.onWrite(null);
                      } else if (event.key === 'Enter' || event.key === 'F2') {
                        event.preventDefault();
                        event.stopPropagation();
                        beginEdit();
                      } else if (
                        event.key.length === 1 ||
                        event.key === 'Backspace' ||
                        event.key === 'Delete'
                      ) {
                        event.preventDefault();
                        event.stopPropagation();
                        beginEdit(event.key.length === 1 ? event.key : '');
                      }
                    }}
                  >
                    <Show when={hasResolvedMentionLabel()}>
                      <span class="sr-only">{props.column.name}: </span>
                    </Show>
                    <span class="truncate">
                      <Show
                        when={mentionPreview()}
                        fallback={
                          <Show
                            when={
                              isEntity() &&
                              typeof props.value === 'string' &&
                              props.column.specificEntityType &&
                              props.renderMentionValue
                            }
                            fallback={
                              formatCellValue(props.column, props.value) || (
                                <span class="opacity-40">
                                  {props.emptyLabel || '—'}
                                </span>
                              )
                            }
                          >
                            {props.renderMentionValue?.(
                              String(props.value),
                              props.column.specificEntityType!
                            )}
                          </Show>
                        }
                      >
                        {(preview) => preview().mention.label}
                      </Show>
                    </span>
                  </button>
                }
              >
                <Show
                  when={editable()}
                  fallback={
                    <div
                      ref={(element) => {
                        trigger = element;
                      }}
                      tabindex={-1}
                      class="px-2.5 py-1.5 outline-none focus-visible:ring-2 focus-visible:ring-ink/50"
                    >
                      <Show when={props.value !== null}>
                        <SelectPill label={String(props.value)} />
                      </Show>
                    </div>
                  }
                >
                  <SelectCell
                    {...props}
                    onReady={(control) => {
                      selectControl = control;
                    }}
                  />
                </Show>
              </Show>
            }
          >
            <div
              ref={booleanWrapper}
              tabindex={editable() ? undefined : -1}
              class="flex min-h-9 items-center px-3 outline-none focus-visible:ring-2 focus-visible:ring-ink/50"
            >
              <input
                ref={(element) => {
                  trigger = element;
                }}
                type="checkbox"
                checked={Boolean(props.value)}
                disabled={!editable()}
                aria-label={props.column.name}
                class="size-3.5 rounded border-edge-muted accent-ink outline-none focus-visible:ring-2 focus-visible:ring-ink/50 disabled:opacity-50"
                onChange={(event) =>
                  void props.onWrite(event.currentTarget.checked ? 1 : 0)
                }
                onKeyDown={(event) => {
                  if (!event.isComposing && event.keyCode !== 229)
                    navigate(event);
                }}
              />
            </div>
          </Show>
        }
      >
        <InlineEditor
          column={props.column}
          originalValue={props.value}
          emptyLabel={props.emptyLabel}
          draft={draft()}
          selectAll={selectAll()}
          onDraft={updateDraft}
          mentionOpen={mentionOpen()}
          onMentionClose={closeMention}
          onWrite={props.onWrite}
          onClose={finishEdit}
          onEditorReady={(focus) => {
            focusEditor = focus;
            props.onEditorReady?.(focus);
          }}
          onNavigate={(direction) => {
            if (props.onNavigate?.(direction)) return true;
            const previousFocus = document.activeElement;
            queueMicrotask(() => {
              // Solid may still be replacing the input with its display trigger.
              // Do not take focus back if another control received it meanwhile.
              if (
                document.activeElement === previousFocus ||
                document.activeElement === document.body ||
                document.activeElement === trigger
              )
                focusAdjacent(trigger, direction);
            });
            return true;
          }}
        />
      </Show>
      <Show when={mentionOpen() && mentionsEnabled()}>
        {props.renderMentionPicker?.({
          get anchor() {
            return cell;
          },
          get specificEntityType() {
            return props.column.specificEntityType ?? undefined;
          },
          get value() {
            return isEntity() && typeof props.value === 'string'
              ? props.value
              : null;
          },
          get search() {
            return mentionSearch();
          },
          onSearchChange: (value) => {
            setMentionSearch(value);
            if (!isEntity()) setDraft(`@${value}`);
          },
          onSelect: selectMention,
          onClose: closeMention,
        })}
      </Show>
    </div>
  );
}

function InlineEditor(props: {
  column: DatabaseViewColumn;
  originalValue: DatabaseCellValue;
  emptyLabel?: string;
  draft: string;
  selectAll: boolean;
  mentionOpen?: boolean;
  onMentionClose?: () => void;
  onDraft: (value: string) => void;
  onWrite: (value: DatabaseCellValue) => Promise<boolean>;
  onClose: (restoreFocus?: boolean) => void;
  onEditorReady?: (focus: () => void) => void;
  onNavigate?: (direction: 1 | -1) => boolean;
}) {
  let input: HTMLInputElement | undefined;
  const [error, setError] = createSignal('');
  let finishing = false;
  const initialDraft =
    props.originalValue === null
      ? ''
      : props.column.dataType === 'DATE'
        ? String(props.originalValue).slice(0, 10)
        : String(props.originalValue);
  const focus = () => {
    input?.focus();
    if (props.selectAll) input?.select();
    else if (input?.type === 'text')
      input.setSelectionRange(input.value.length, input.value.length);
  };
  onMount(() => {
    focus();
  });
  function commit(restoreFocus = true) {
    if (finishing) return false;
    if (props.draft === initialDraft) {
      finishing = true;
      props.onClose(restoreFocus);
      return true;
    }
    const value =
      props.draft.trim() === ''
        ? null
        : props.column.dataType === 'NUMBER'
          ? Number(props.draft)
          : props.column.dataType === 'DATE'
            ? `${props.draft}T00:00:00.000Z`
            : props.draft;
    if (typeof value === 'number' && !Number.isFinite(value)) {
      setError('Enter a valid number');
      input?.focus();
      return false;
    }
    if (
      props.column.dataType === 'DATE' &&
      value !== null &&
      (!/^\d{4}-\d{2}-\d{2}$/.test(props.draft) ||
        Number.isNaN(Date.parse(String(value))) ||
        new Date(String(value)).toISOString().slice(0, 10) !== props.draft)
    ) {
      setError('Use YYYY-MM-DD');
      input?.focus();
      return false;
    }
    finishing = true;
    props.onClose(restoreFocus);
    void props.onWrite(value);
    return true;
  }
  return (
    <div class="relative min-w-0">
      <input
        ref={(element) => {
          input = element;
          props.onEditorReady?.(focus);
        }}
        type={
          props.column.dataType === 'DATE' && props.selectAll ? 'date' : 'text'
        }
        placeholder={
          props.column.dataType === 'DATE' ? 'YYYY-MM-DD' : props.emptyLabel
        }
        inputmode={props.column.dataType === 'NUMBER' ? 'decimal' : undefined}
        aria-label={`Edit ${props.column.name}`}
        aria-invalid={Boolean(error())}
        title={error() || undefined}
        value={props.draft}
        onInput={(event) => {
          props.onDraft(event.currentTarget.value);
          setError('');
        }}
        onBlur={() => {
          if (!props.mentionOpen) void commit(false);
        }}
        onKeyDown={(event) => {
          event.stopPropagation();
          if (event.isComposing || event.keyCode === 229) return;
          if (props.mentionOpen) {
            if (['Enter', 'Tab', 'Escape'].includes(event.key))
              event.preventDefault();
            if (event.key === 'Escape') props.onMentionClose?.();
            return;
          }
          if (event.key === 'Enter') {
            event.preventDefault();
            void commit();
          }
          if (event.key === 'Escape') {
            event.preventDefault();
            finishing = true;
            props.onClose();
          }
          if (event.key === 'Tab') {
            if (!commit(false)) event.preventDefault();
            else if (props.onNavigate?.(event.shiftKey ? -1 : 1))
              event.preventDefault();
          }
        }}
        class="min-h-9 w-full min-w-0 rounded border border-ink/40 bg-input-focus px-2.5 py-1.5 text-[13px] text-ink outline-none ring-2 ring-ink/10"
      />
      <Show when={error()}>
        <span
          class="absolute left-0 top-full z-10 rounded bg-menu px-2 py-1 text-xs text-failure-ink shadow-menu"
          role="alert"
        >
          {error()}
        </span>
      </Show>
    </div>
  );
}

function SelectCell(props: GridCellProps) {
  const [open, setOpen] = createSignal(false);
  const [search, setSearch] = createSignal('');
  const [searching, setSearching] = createSignal(false);
  const [adding, setAdding] = createSignal(false);
  const [draft, setDraft] = createSignal('');
  const [pending, setPending] = createSignal(false);
  const [error, setError] = createSignal('');
  let trigger: HTMLButtonElement | undefined;
  let searchInput: HTMLInputElement | undefined;
  let menu: HTMLElement | undefined;
  let optionEditor: HTMLDivElement | undefined;
  let navigating: 1 | -1 | undefined;
  const label = () => (props.value === null ? '' : String(props.value));
  const options = () =>
    props.column.options.filter((option) =>
      String(option).toLocaleLowerCase().includes(search().toLocaleLowerCase())
    );
  const edit = (seed?: string) => {
    setSearch(seed ?? '');
    setSearching(true);
    setOpen(true);
  };
  function openWithKeyboard(event: KeyboardEvent) {
    if (
      event.isComposing ||
      event.keyCode === 229 ||
      event.altKey ||
      event.ctrlKey ||
      event.metaKey ||
      !['Enter', ' ', 'F2'].includes(event.key)
    )
      return;
    event.preventDefault();
    event.stopImmediatePropagation();
    // Kobalte's trigger scroll helper loops on nested scroll containers when
    // the document cannot scroll. Focus already reveals the selected cell.
    edit();
  }
  onMount(() => props.onReady?.({ focus: () => trigger?.focus(), edit }));
  onCleanup(() => props.onReady?.(undefined));
  function navigate(event: KeyboardEvent) {
    if (
      event.key !== 'Tab' ||
      !props.onNavigate ||
      event.isComposing ||
      event.keyCode === 229
    )
      return;
    event.preventDefault();
    event.stopPropagation();
    const selected =
      event.target instanceof HTMLElement
        ? event.target.closest<HTMLElement>('[data-option-value]')?.dataset
            .optionValue
        : undefined;
    const matched =
      event.target === searchInput && search().trim()
        ? options()[0]
        : undefined;
    const value = selected ?? matched;
    if (open() && value !== undefined && String(value) !== label())
      void props.onWrite(String(value));
    const direction = event.shiftKey ? -1 : 1;
    if (open()) {
      navigating = direction;
      setOpen(false);
    } else {
      moveToCell(direction);
    }
  }
  function moveToCell(direction: 1 | -1) {
    if (!props.onNavigate?.(direction)) focusAdjacent(trigger, direction);
  }
  function menuKeyDown(event: KeyboardEvent) {
    if (event.isComposing || event.keyCode === 229) return;
    navigate(event);
    if (
      event.defaultPrevented ||
      event.target === searchInput ||
      event.ctrlKey ||
      event.metaKey ||
      event.altKey ||
      event.key.length !== 1 ||
      event.key === ' '
    )
      return;
    event.preventDefault();
    event.stopPropagation();
    setSearch(event.key);
    setSearching(true);
    queueMicrotask(() => searchInput?.focus());
  }
  function closeOptionEditor() {
    const restoreFocus = optionEditor?.contains(document.activeElement);
    setAdding(false);
    if (restoreFocus) queueMicrotask(() => trigger?.focus());
  }
  async function add() {
    const entered = draft().trim();
    if (!entered || pending()) return;
    if (
      props.column.dataType === 'SELECT_NUMBER' &&
      !Number.isFinite(Number(entered))
    ) {
      setError('Enter a number');
      return;
    }
    const value =
      props.column.dataType === 'SELECT_NUMBER'
        ? String(Number(entered))
        : entered;
    const existing = props.column.options.find(
      (option) => String(option).toLowerCase() === value.toLowerCase()
    );
    setPending(true);
    const saved =
      existing !== undefined
        ? await props.onWrite(String(existing))
        : await props.onAddOption(value);
    setPending(false);
    if (saved) closeOptionEditor();
    else setError('Could not save. Try again.');
  }
  return (
    <Show
      when={adding()}
      fallback={
        <Dropdown
          open={open()}
          onOpenChange={(value) => {
            setOpen(value);
            if (!value) {
              setSearch('');
              setSearching(false);
            }
          }}
        >
          <Dropdown.Trigger
            ref={(element: HTMLButtonElement) => {
              trigger = element;
              element.addEventListener('keydown', openWithKeyboard, true);
              onCleanup(() =>
                element.removeEventListener('keydown', openWithKeyboard, true)
              );
            }}
            variant="ghost"
            class="group h-auto min-h-9 w-full min-w-0 justify-between rounded px-2.5 py-1 text-left outline-none focus-visible:ring-2 focus-visible:ring-ink/50"
            aria-label={`${props.column.name}: ${label() || 'Empty'}`}
            onKeyDown={(event: KeyboardEvent) => {
              if (event.isComposing || event.keyCode === 229) {
                edit('');
                return;
              }
              navigate(event);
              if (
                !event.defaultPrevented &&
                event.key.length === 1 &&
                !event.ctrlKey &&
                !event.metaKey &&
                !event.altKey &&
                event.key !== ' '
              ) {
                event.preventDefault();
                edit(event.key);
              }
            }}
          >
            <Show
              when={label()}
              fallback={
                <span class="text-xs text-ink-placeholder opacity-40">—</span>
              }
            >
              <SelectPill label={label()} />
            </Show>
            <CaretDownIcon class="ml-1 size-3 shrink-0 text-ink-muted opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100" />
          </Dropdown.Trigger>
          <Dropdown.Content
            ref={(element: HTMLElement) => {
              menu = element;
              element.addEventListener('keydown', menuKeyDown, true);
              onCleanup(() =>
                element.removeEventListener('keydown', menuKeyDown, true)
              );
            }}
            class="min-w-48 max-w-72"
            // A menu's closing animation must not delay Tab into the next cell.
            style={{ animation: 'none' }}
            onOpenAutoFocus={(event) => {
              if (searching()) {
                event.preventDefault();
                queueMicrotask(() => searchInput?.focus());
              }
            }}
            onFocusIn={(event) => {
              // Kobalte also focuses the menu after its deferred collection
              // setup. A typed search owns focus until the user chooses a row.
              if (searching() && event.target === menu) searchInput?.focus();
            }}
            onCloseAutoFocus={(event) => {
              if (navigating) {
                event.preventDefault();
                const direction = navigating;
                navigating = undefined;
                // Wait until the menu releases its focus trap and restores its
                // trigger before mounting the next cell's editor.
                queueMicrotask(() => moveToCell(direction));
              }
            }}
          >
            <Show when={searching()}>
              <input
                ref={searchInput}
                aria-label={`Search ${props.column.name} options`}
                value={search()}
                onInput={(event) => setSearch(event.currentTarget.value)}
                on:focusin={(event) => event.stopPropagation()}
                on:keydown={(event) => {
                  event.stopPropagation();
                  if (event.isComposing || event.keyCode === 229) return;
                  navigate(event);
                  if (event.key === 'Enter' && options()[0] !== undefined) {
                    event.preventDefault();
                    void props.onWrite(String(options()[0]));
                    setOpen(false);
                  } else if (event.key === 'ArrowDown') {
                    event.preventDefault();
                    menu
                      ?.querySelector<HTMLElement>('[data-option-value]')
                      ?.focus();
                  } else if (event.key === 'Escape') {
                    event.preventDefault();
                    setOpen(false);
                  }
                }}
                class="mb-1 h-8 w-full rounded border border-edge-muted bg-input px-2 text-xs outline-none focus:border-ink/50"
              />
            </Show>
            <Dropdown.Group>
              <Dropdown.GroupLabel>{props.column.name}</Dropdown.GroupLabel>
              <Dropdown.Item onSelect={() => void props.onWrite(null)}>
                <span class="flex-1 text-ink-muted">Clear value</span>
                <Show when={props.value === null}>
                  <CheckIcon class="size-3.5" />
                </Show>
              </Dropdown.Item>
              <For each={options()}>
                {(option) => (
                  <Dropdown.Item
                    data-option-value={String(option)}
                    onSelect={() => void props.onWrite(String(option))}
                  >
                    <span class="min-w-0 flex-1">
                      <SelectPill label={String(option)} />
                    </span>
                    <Show when={String(option) === label()}>
                      <CheckIcon class="size-3.5 text-ink-muted" />
                    </Show>
                  </Dropdown.Item>
                )}
              </For>
            </Dropdown.Group>
            <Dropdown.Group>
              <Dropdown.Item
                onSelect={() => {
                  setDraft('');
                  setError('');
                  setAdding(true);
                }}
              >
                <PlusIcon class="size-3.5" />
                Add option
              </Dropdown.Item>
            </Dropdown.Group>
          </Dropdown.Content>
        </Dropdown>
      }
    >
      <div ref={optionEditor} class="p-1">
        <NewOptionInput
          value={draft()}
          pending={pending()}
          onInput={setDraft}
          onSave={() => void add()}
          onCancel={closeOptionEditor}
        />
        <Show when={error()}>
          <p role="alert" class="px-1 text-xs text-failure-ink">
            {error()}
          </p>
        </Show>
      </div>
    </Show>
  );
}

function NewOptionInput(props: {
  value: string;
  pending: boolean;
  onInput: (value: string) => void;
  onSave: () => void;
  onCancel: () => void;
}) {
  let input: HTMLInputElement | undefined;
  // Wait for the closing menu to restore focus before focusing its replacement.
  onMount(() => queueMicrotask(() => input?.focus()));
  return (
    <div class="flex items-center gap-1">
      <input
        ref={input}
        aria-label="New option"
        maxlength={200}
        placeholder="New option…"
        value={props.value}
        readOnly={props.pending}
        class="min-h-8 w-full min-w-0 rounded border border-ink/40 bg-input px-2 text-xs outline-none"
        onInput={(event) => props.onInput(event.currentTarget.value)}
        onKeyDown={(event) => {
          event.stopPropagation();
          if (event.isComposing || event.keyCode === 229) return;
          if (event.key === 'Enter') {
            event.preventDefault();
            props.onSave();
          }
          if (event.key === 'Escape') {
            event.preventDefault();
            props.onCancel();
          }
        }}
      />
      <button
        type="button"
        aria-label="Save option"
        disabled={props.pending || !props.value.trim()}
        class="rounded p-1.5 text-accent hover:bg-hover disabled:opacity-40"
        onClick={props.onSave}
      >
        <CheckIcon class="size-3.5" />
      </button>
    </div>
  );
}

/** Editors replace or portal their focused node, so finish Tab from the cell's position. */
function focusAdjacent(trigger: HTMLElement | undefined, direction: 1 | -1) {
  if (!trigger?.isConnected) return false;
  const dialog = trigger.closest<HTMLElement>('[role="dialog"]');
  const manager = createFocusManager(
    () => dialog ?? trigger.ownerDocument.body
  );
  const options = { from: trigger, tabbable: true, wrap: Boolean(dialog) };
  return Boolean(
    direction === 1
      ? manager.focusNext(options)
      : manager.focusPrevious(options)
  );
}
