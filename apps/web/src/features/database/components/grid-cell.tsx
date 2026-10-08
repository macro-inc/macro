import { Popover } from '@kobalte/core/popover';
import CaretDownIcon from '@phosphor/caret-down.svg';
import { PropertyDateSelector } from '@property/editors/selectors/PropertyDateSelector';
import { Checkbox } from '@ui/components/Checkbox';
import { Dropdown } from '@ui/components/Dropdown';
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
import { Dynamic } from 'solid-js/web';
import { match } from 'ts-pattern';
import type { CellTextEditorProps } from '../../../components/cell-text-editor/types';
import {
  startUiOperation,
  type UiOperation,
} from '../../../observability/ui-operation';
import { useOptionEditing } from '../context/option-editing';
import { fromCellDate, toCellDate } from '../core/cell-date';
import {
  type DatabaseEntityType,
  type DatabaseMention,
  inferDatabaseNumber,
} from '../core/column-inference';
import {
  type DatabaseCellValue,
  type DatabaseViewColumn,
  databaseCellValues,
  isOptionColumn,
} from '../core/database-view';
import type {
  GridCellControl,
  GridCellEditorOptions,
} from '../core/grid-cell-editor';
import { canEditCell, formatCellValue } from '../core/table';
import { focusAdjacent } from './cell-focus';
import { OptionPicker } from './option-picker';
import { createPopupCellKeys, isComposingKey } from './popup-cell-keys';
import { SelectPill } from './select-pill';

export type DatabaseMentionPickerProps = {
  anchor?: HTMLElement;
  specificEntityType?: DatabaseEntityType;
  value: string | null;
  search: string;
  onSearchChange?: (search: string) => void;
  onSelect: (mention: DatabaseMention, direction?: 1 | -1) => void;
  onClose: (restoreFocus?: boolean) => void;
};

export type DatabaseTextEditorProps = CellTextEditorProps & {
  inferType?: boolean;
  onInferMention?: (mention: DatabaseMention) => void;
};

export type GridCellProps = GridCellEditorOptions & {
  column: DatabaseViewColumn;
  value: DatabaseCellValue;
  emptyLabel?: string;
  canEdit: boolean;
  renderTextEditor?: (props: DatabaseTextEditorProps) => JSX.Element;
  renderTextValue?: (value: string) => JSX.Element;
  renderMentionPicker?: (props: DatabaseMentionPickerProps) => JSX.Element;
  renderMentionValue?: (id: string, type: DatabaseEntityType) => JSX.Element;
  onMention?: (mention: DatabaseMention) => Promise<boolean>;
  onWrite: (value: DatabaseCellValue) => Promise<boolean>;
  onAddOption: (label: string, value?: DatabaseCellValue) => Promise<boolean>;
};

/** What a cell renders: its inline editor, or one display per column kind. */
type GridCellKind =
  | 'editing'
  | 'boolean'
  | 'date'
  | 'select'
  | 'readonly-select'
  | 'text';

/** A presentational cell. Writes, including new options, belong to its table controller. */
export function GridCell(props: GridCellProps) {
  const opening = createEditorMeasurement(() => props.column.dataType);
  const write = async (value: DatabaseCellValue) => {
    const operation = startUiOperation('database.cell.commit', {
      attributes: { 'database.column_type': props.column.dataType },
    });
    try {
      const saved = await operation.run(() => props.onWrite(value));
      operation.mark('write_completed');
      if (saved) operation.afterPaint();
      else operation.finish('error');
      return saved;
    } catch (error) {
      operation.finish('error');
      throw error;
    }
  };
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
  const [selectedMention, setSelectedMention] = createSignal<MentionPreview>();
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
  const isBoolean = () =>
    props.column.dataType === 'BOOLEAN' && !props.column.isMultiSelect;
  const isDate = () =>
    props.column.dataType === 'DATE' && !props.column.isMultiSelect;
  const hasPopupEditor = () =>
    isOptionColumn(props.column) || (isDate() && editable());
  const startsEditing = Boolean(
    props.initialEdit && editable() && props.column.dataType === 'STRING'
  );
  const [editing, setEditing] = createSignal(startsEditing);
  const [draft, setDraft] = createSignal(
    startsEditing && props.value !== null ? String(props.value) : ''
  );
  const [selectAll, setSelectAll] = createSignal(true);
  const cellKind = createMemo<GridCellKind>(() =>
    match({
      editing: editing() && !isEntity(),
      boolean: isBoolean(),
      date: isDate() && editable(),
      option: isOptionColumn(props.column),
      editable: editable(),
    })
      .with({ editing: true }, () => 'editing' as const)
      .with({ boolean: true }, () => 'boolean' as const)
      .with({ date: true }, () => 'date' as const)
      .with({ option: true, editable: true }, () => 'select' as const)
      .with({ option: true, editable: false }, () => 'readonly-select' as const)
      .with({ option: false }, () => 'text' as const)
      .exhaustive()
  );
  let trigger: HTMLElement | undefined;
  let booleanWrapper: HTMLDivElement | undefined;
  let focusEditor: (() => void) | undefined;
  let popupControl: GridCellControl | undefined;
  const updateEditor = (seed?: string) => {
    if (!editable()) return;
    setSelectedMention(undefined);
    if (isEntity()) {
      setMentionSearch(seed?.replace(/^@/, '') ?? '');
      setDraft(seed?.replace(/^@/, '') ?? '');
      setSelectAll(false);
      setEditing(true);
      setMentionOpen(true);
      return;
    }
    setSelectAll(seed === undefined);
    setDraft(
      seed !== undefined
        ? seed
        : props.value === null
          ? ''
          : String(props.value)
    );
    setEditing(true);
    if (
      !props.renderTextEditor &&
      mentionsEnabled() &&
      draft().startsWith('@')
    ) {
      setMentionSearch(draft().slice(1));
      setMentionOpen(true);
    }
  };
  const beginEdit = (seed?: string, event?: Event) => {
    if (!editable()) return;
    opening.measure(() => updateEditor(seed), event, !editing());
  };
  const updateDraft = (value: string) => {
    setDraft(value);
    if (
      mentionsEnabled() &&
      (isEntity() || (!props.renderTextEditor && value.startsWith('@')))
    ) {
      setMentionSearch(value.replace(/^@/, ''));
      setMentionOpen(true);
    }
  };
  const closeMention = (restoreFocus = true) => {
    setMentionOpen(false);
    if (isEntity()) setEditing(false);
    if (restoreFocus)
      queueMicrotask(() => (editing() ? focusEditor?.() : trigger?.focus()));
  };
  async function writeMention(
    onMention: (mention: DatabaseMention) => Promise<boolean>,
    preview: MentionPreview
  ) {
    await onMention(preview.mention);
    setSelectedMention((current) => {
      if (current !== preview) return current;
      if (
        props.value !== preview.originalValue &&
        props.value !== preview.mention.id
      )
        return undefined;
      return { mention: preview.mention, originalValue: props.value };
    });
  }
  const selectMention = (mention: DatabaseMention, direction?: 1 | -1) => {
    const onMention = props.onMention;
    if (!mentionsEnabled() || !onMention) return;
    const preview = {
      mention,
      originalValue: props.value,
    };
    setSelectedMention(preview);
    setEditing(false);
    setMentionOpen(false);
    void writeMention(onMention, preview);
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
        else if (hasPopupEditor() && popupControl) popupControl.focus();
        else if (isBoolean() && !editable()) booleanWrapper?.focus();
        else trigger?.focus();
      },
      edit: (seed) => {
        if (!editable()) return;
        if (hasPopupEditor()) popupControl?.edit(seed);
        else if (props.column.dataType === 'BOOLEAN') trigger?.focus();
        else if (editing()) focusEditor?.();
        else beginEdit(seed);
      },
    })
  );
  onCleanup(() => props.onReady?.(undefined));

  const renderEditor = () => (
    <InlineEditor
      column={props.column}
      renderTextEditor={props.renderTextEditor}
      onInferMention={selectMention}
      originalValue={props.value}
      emptyLabel={props.emptyLabel}
      draft={draft()}
      selectAll={selectAll()}
      onDraft={updateDraft}
      mentionOpen={mentionOpen()}
      onMentionClose={closeMention}
      onWrite={write}
      onClose={finishEdit}
      onEditorReady={(focus) => {
        focusEditor = focus;
        props.onEditorReady?.(focus);
      }}
      onNavigateRow={
        props.onNavigateRow
          ? (direction) => {
              if (props.onNavigateRow?.(direction)) return true;
              queueMicrotask(() => trigger?.focus());
              return false;
            }
          : undefined
      }
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
  );

  const content: Record<GridCellKind, () => JSX.Element> = {
    editing: renderEditor,
    boolean: () => (
      <BooleanCell
        column={props.column}
        value={props.value}
        editable={editable()}
        wrapperRef={(element) => {
          booleanWrapper = element;
        }}
        inputRef={(element) => {
          trigger = element;
        }}
        onNavigate={props.onNavigate}
        onWrite={write}
      />
    ),
    date: () => (
      <DateCell
        {...props}
        onWrite={write}
        onReady={(control) => {
          popupControl = control;
        }}
      />
    ),
    select: () => (
      <SelectCell
        {...props}
        onWrite={write}
        onReady={(control) => {
          popupControl = control;
        }}
      />
    ),
    'readonly-select': () => (
      <div
        ref={(element) => {
          trigger = element;
        }}
        tabindex={-1}
        class="px-2.5 py-1.5 outline-none focus-visible:ring-2 focus-visible:ring-ink/50"
      >
        <Show when={props.value !== null}>
          <SelectPill label={String(props.value)} column={props.column} />
        </Show>
      </div>
    ),
    text: () => (
      <div class="relative">
        {/* Keep the resolved label and its subscription alive while picking. */}
        <div
          inert={isEntity() && editing()}
          classList={{
            invisible: isEntity() && editing() && draft() !== '',
          }}
        >
          <TextCell
            column={props.column}
            value={props.value}
            emptyLabel={props.emptyLabel}
            editable={editable()}
            isEntity={isEntity()}
            mentionPreview={mentionPreview()}
            hasResolvedMentionLabel={hasResolvedMentionLabel()}
            renderTextValue={props.renderTextValue}
            renderMentionValue={props.renderMentionValue}
            ref={(element) => {
              trigger = element;
            }}
            onNavigate={props.onNavigate}
            onBeginEdit={beginEdit}
            onClearEntity={() => {
              setSelectedMention(undefined);
              void write(null);
            }}
          />
        </div>
        <Show when={isEntity() && editing()}>
          <div class="absolute inset-x-0 top-0">{renderEditor()}</div>
        </Show>
      </div>
    ),
  };
  return (
    <div ref={cell} class="relative min-w-0">
      <Dynamic component={content[cellKind()]} />
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

/** Tab leaves a cell through the grid when the grid navigates. */
function navigateOnTab(
  event: KeyboardEvent,
  onNavigate: ((direction: 1 | -1) => boolean) | undefined
) {
  if (event.key === 'Tab' && onNavigate?.(event.shiftKey ? -1 : 1)) {
    event.preventDefault();
    event.stopPropagation();
  }
}

function BooleanCell(props: {
  column: DatabaseViewColumn;
  value: DatabaseCellValue;
  editable: boolean;
  wrapperRef: (element: HTMLDivElement) => void;
  inputRef: (element: HTMLInputElement) => void;
  onNavigate?: (direction: 1 | -1) => boolean;
  onWrite: (value: DatabaseCellValue) => Promise<boolean>;
}) {
  let wrapper: HTMLDivElement | undefined;
  onMount(() => {
    const input = wrapper?.querySelector<HTMLInputElement>(
      'input[type="checkbox"]'
    );
    if (input) props.inputRef(input);
  });
  return (
    <Checkbox
      ref={(element: HTMLDivElement) => {
        wrapper = element;
        props.wrapperRef(element);
      }}
      tabindex={props.editable ? undefined : -1}
      class="flex min-h-9 items-center px-3 outline-none focus-visible:ring-2 focus-visible:ring-ink/50"
      checked={Boolean(props.value)}
      disabled={!props.editable}
      onChange={(checked) => void props.onWrite(checked ? 1 : 0)}
      onKeyDown={(event: KeyboardEvent) => {
        if (!isComposingKey(event)) navigateOnTab(event, props.onNavigate);
      }}
    >
      <Checkbox.Control />
      <Checkbox.Label class="sr-only">{props.column.name}</Checkbox.Label>
    </Checkbox>
  );
}

type MentionPreview = {
  mention: DatabaseMention;
  originalValue: DatabaseCellValue;
};

/** A scalar or entity value that edits inline; entity values show their mention. */
function TextCell(props: {
  column: DatabaseViewColumn;
  value: DatabaseCellValue;
  emptyLabel?: string;
  editable: boolean;
  isEntity: boolean;
  mentionPreview: MentionPreview | undefined;
  hasResolvedMentionLabel: boolean;
  renderTextValue?: (value: string) => JSX.Element;
  renderMentionValue?: (id: string, type: DatabaseEntityType) => JSX.Element;
  ref: (element: HTMLButtonElement) => void;
  onNavigate?: (direction: 1 | -1) => boolean;
  onBeginEdit: (seed?: string, event?: Event) => void;
  onClearEntity: () => void;
}) {
  // Refreshes rebuild row objects; only a changed value may rerun renderers and remount previews.
  const value = createMemo(() => props.value);
  const formatted = () => formatCellValue(props.column, value());
  return (
    <button
      ref={props.ref}
      type="button"
      class="flex min-h-9 w-full min-w-0 items-center rounded px-2.5 py-1.5 text-left text-[13px] leading-5 outline-none hover:bg-hover focus-visible:ring-2 focus-visible:ring-ink/50"
      classList={{
        'text-ink-muted': !props.editable,
        'text-ink-placeholder': value() === null && !props.mentionPreview,
        'font-medium': props.column.dataType === 'STRING',
      }}
      aria-label={
        props.hasResolvedMentionLabel
          ? undefined
          : `${props.column.name}: ${props.mentionPreview?.mention.label || formatted() || props.emptyLabel || 'Empty'}${props.editable ? '. Click to edit' : ''}`
      }
      aria-description={
        props.hasResolvedMentionLabel && props.editable
          ? 'Click to edit'
          : undefined
      }
      aria-readonly={!props.editable}
      title={
        props.mentionPreview?.mention.label ||
        (!props.isEntity && formatted()) ||
        undefined
      }
      onClick={(event) => props.editable && props.onBeginEdit(undefined, event)}
      onKeyDown={(event) => {
        if (!props.editable) return;
        if (isComposingKey(event)) {
          props.onBeginEdit('', event);
          return;
        }
        navigateOnTab(event, props.onNavigate);
        if (
          event.defaultPrevented ||
          event.metaKey ||
          event.ctrlKey ||
          event.altKey
        )
          return;
        if (
          props.isEntity &&
          (event.key === 'Backspace' || event.key === 'Delete')
        ) {
          event.preventDefault();
          event.stopPropagation();
          props.onClearEntity();
        } else if (event.key === 'Enter' || event.key === 'F2') {
          event.preventDefault();
          event.stopPropagation();
          props.onBeginEdit(undefined, event);
        } else if (
          event.key.length === 1 ||
          event.key === 'Backspace' ||
          event.key === 'Delete'
        ) {
          event.preventDefault();
          event.stopPropagation();
          props.onBeginEdit(event.key.length === 1 ? event.key : '', event);
        }
      }}
    >
      <Show when={props.hasResolvedMentionLabel}>
        <span class="sr-only">{props.column.name}: </span>
      </Show>
      <span class="truncate">
        <Switch
          fallback={
            (props.column.dataType === 'STRING' &&
            typeof value() === 'string' &&
            props.renderTextValue
              ? props.renderTextValue(String(value()))
              : formatted()) || (
              <span class="opacity-40">{props.emptyLabel || '—'}</span>
            )
          }
        >
          <Match when={props.mentionPreview}>
            {(preview) => preview().mention.label}
          </Match>
          <Match
            when={
              props.isEntity &&
              typeof value() === 'string' &&
              props.renderMentionValue
                ? props.column.specificEntityType
                : undefined
            }
          >
            {(entityType) => (
              <>{props.renderMentionValue?.(String(value()), entityType())}</>
            )}
          </Match>
        </Switch>
      </span>
    </button>
  );
}

function InlineEditor(props: {
  renderTextEditor?: (props: DatabaseTextEditorProps) => JSX.Element;
  onInferMention?: (mention: DatabaseMention) => void;
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
  onNavigateRow?: (direction: 1 | -1) => boolean;
}) {
  let input: HTMLInputElement | undefined;
  let textFocus: (() => void) | undefined;
  const [error, setError] = createSignal('');
  let finishing = false;
  const showingReference = () =>
    props.column.dataType === 'ENTITY' &&
    props.originalValue !== null &&
    props.draft === '';
  const initialDraft =
    props.originalValue === null ? '' : String(props.originalValue);
  const focus = () => {
    if (textFocus) {
      textFocus();
      return;
    }
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
    // References commit only through the native pick callback, never as raw @ text.
    if (props.column.dataType === 'ENTITY' || props.draft === initialDraft) {
      finishing = true;
      props.onClose(restoreFocus);
      return true;
    }
    const value =
      props.draft.trim() === ''
        ? null
        : props.column.dataType === 'NUMBER'
          ? inferDatabaseNumber(props.draft)
          : props.draft;
    if (value === undefined) {
      setError('Enter a valid number');
      input?.focus();
      return false;
    }
    finishing = true;
    props.onClose(restoreFocus);
    void props.onWrite(value);
    return true;
  }
  const onKeyDown = (event: KeyboardEvent) => {
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
      commit();
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
    if (
      (event.key === 'ArrowDown' || event.key === 'ArrowUp') &&
      !event.shiftKey &&
      !event.altKey &&
      props.onNavigateRow
    ) {
      const direction = event.key === 'ArrowDown' ? 1 : -1;
      if (!caretOnEdgeLine(event.currentTarget, direction)) return;
      event.preventDefault();
      if (commit(false)) props.onNavigateRow(direction);
    }
  };
  return (
    <div class="relative min-w-0">
      <Show
        when={props.column.dataType === 'STRING' && props.renderTextEditor}
        fallback={
          <input
            ref={(element) => {
              input = element;
              props.onEditorReady?.(focus);
            }}
            type="text"
            placeholder={showingReference() ? undefined : props.emptyLabel}
            inputmode={
              props.column.dataType === 'NUMBER' ? 'decimal' : undefined
            }
            aria-label={`Edit ${props.column.name}`}
            aria-invalid={Boolean(error())}
            title={error() || undefined}
            value={props.draft}
            onInput={(event) => {
              props.onDraft(event.currentTarget.value);
              setError('');
            }}
            onBlur={() => {
              if (!props.mentionOpen) commit(false);
            }}
            onKeyDown={onKeyDown}
            class="min-h-9 w-full min-w-0 rounded border border-ink/40 px-2.5 py-1.5 text-[13px] text-ink outline-none ring-2 ring-ink/10"
            classList={{
              'bg-input-focus': !showingReference(),
              'bg-transparent caret-transparent': showingReference(),
            }}
          />
        }
      >
        {(render) =>
          render()({
            label: `Edit ${props.column.name}`,
            get value() {
              return props.draft;
            },
            class:
              'min-h-9 w-full min-w-0 rounded border border-ink/40 bg-input-focus px-2.5 py-1.5 text-[13px] text-ink outline-none ring-2 ring-ink/10',
            autoFocus: true,
            selectAll: props.selectAll,
            inferType: props.column.inferType,
            onInferMention: (mention) => {
              // Removing a focused editor can synchronously blur it. The typed
              // reference write owns this commit; do not also save the @ draft.
              finishing = true;
              props.onInferMention?.(mention);
            },
            onInput: props.onDraft,
            onKeyDown,
            onBlur: () => {
              if (!props.mentionOpen) commit(false);
            },
            onReady: (focus) => {
              textFocus = focus;
              props.onEditorReady?.(focus);
            },
          })
        }
      </Show>
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

/** One pending measurement per mounted editor, with no per-cell observers. */
function createEditorMeasurement(columnType: () => string) {
  let pending: UiOperation | undefined;
  onCleanup(() => pending?.cancel());
  return {
    measure(work: () => void, event?: Event, cold = false) {
      pending?.cancel();
      const operation = startUiOperation('database.cell.editor.open', {
        event,
        attributes: {
          'database.column_type': columnType(),
          'ui.cold_mount': cold,
        },
      });
      pending = operation;
      try {
        operation.run(work);
        operation.afterPaint();
      } catch (error) {
        operation.finish('error');
        throw error;
      }
    },
  };
}

function SelectCell(props: GridCellProps) {
  const opening = createEditorMeasurement(() => props.column.dataType);
  let openingEvent: Event | undefined;
  const [open, setOpen] = createSignal(false);
  const [search, setSearch] = createSignal('');
  const [error, setError] = createSignal('');
  const editing = useOptionEditing();
  let searchInput: HTMLInputElement | undefined;
  const selected = createMemo(() =>
    databaseCellValues(props.value, props.column)
      .filter((value) => value !== null)
      .map(String)
  );
  const label = () => selected().join(', ');
  const withOption = (option: string, checked = true) => {
    if (!props.column.isMultiSelect) return option;
    const values = selected().filter((value) => value !== option);
    if (checked) values.push(option);
    return values.length
      ? JSON.stringify(
          props.column.dataType === 'SELECT_NUMBER'
            ? values.map(Number)
            : values
        )
      : null;
  };
  // The picker mounts on first use; until then the cell is a plain button.
  const [mounted, setMounted] = createSignal(false);
  const edit = (seed?: string, event?: Event) => {
    openingEvent = undefined;
    opening.measure(
      () => {
        setSearch(seed ?? '');
        setError('');
        setMounted(true);
        setOpen(true);
      },
      event,
      !mounted()
    );
  };
  const keys = createPopupCellKeys({
    get onNavigate() {
      return props.onNavigate;
    },
    edit: (event) => edit(undefined, event),
    close: () => setOpen(false),
  });
  onMount(() => props.onReady?.({ focus: keys.focus, edit }));
  onCleanup(() => props.onReady?.(undefined));
  function tabAway(event: KeyboardEvent, chosen: string | undefined) {
    if (event.key !== 'Tab' || !props.onNavigate) return;
    event.preventDefault();
    event.stopPropagation();
    if (chosen !== undefined && chosen !== label())
      void props.onWrite(withOption(chosen));
    keys.leave(event.shiftKey ? -1 : 1);
  }
  function pick(option: string) {
    if (props.column.isMultiSelect)
      void props.onWrite(withOption(option, !selected().includes(option)));
    else {
      void props.onWrite(option);
      setOpen(false);
    }
  }
  async function create(value: string) {
    setError('');
    const saved = props.column.isMultiSelect
      ? await props.onAddOption(value, withOption(value))
      : await props.onAddOption(value);
    if (!saved) setError('Could not save. Try again.');
    else if (props.column.isMultiSelect) {
      setSearch('');
      searchInput?.focus();
    } else setOpen(false);
  }
  const trigger = {
    onPointerDown: (event: PointerEvent) => {
      openingEvent = event;
    },
    ref: keys.triggerRef,
    class:
      'group flex h-auto min-h-9 w-full min-w-0 items-center justify-between rounded px-2.5 py-1 text-left outline-none hover:bg-hover focus-visible:ring-2 focus-visible:ring-ink/50',
    get 'aria-label'() {
      return `${props.column.name}: ${label() || 'Empty'}`;
    },
    'aria-haspopup': 'listbox' as const,
    onKeyDown: (event: KeyboardEvent) => {
      if (isComposingKey(event)) {
        edit('');
        return;
      }
      if (keys.tabFromTrigger(event)) return;
      if (
        event.key.length === 1 &&
        !event.ctrlKey &&
        !event.metaKey &&
        !event.altKey &&
        event.key !== ' '
      ) {
        event.preventDefault();
        edit(event.key, event);
      }
    },
  };
  const shown = () => (
    <>
      <Show
        when={label()}
        fallback={
          <span class="text-xs text-ink-placeholder opacity-40">—</span>
        }
      >
        <span class="flex min-w-0 flex-wrap gap-1">
          <For each={selected()}>
            {(value) => <SelectPill label={value} column={props.column} />}
          </For>
        </span>
      </Show>
      <CaretDownIcon class="ml-1 size-3 shrink-0 text-ink-muted opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100" />
    </>
  );
  return (
    <Show
      when={mounted()}
      fallback={
        <button
          type="button"
          {...trigger}
          aria-expanded="false"
          onClick={(event) => edit(undefined, event)}
        >
          {shown()}
        </button>
      }
    >
      <Popover
        open={open()}
        onOpenChange={(value) => {
          // A pick closes the picker without passing here; opening starts afresh.
          if (value) {
            edit(undefined, openingEvent);
            openingEvent = undefined;
          } else {
            setOpen(false);
          }
        }}
        placement="bottom-start"
        gutter={4}
      >
        <Popover.Trigger {...trigger}>{shown()}</Popover.Trigger>
        <Popover.Portal>
          <Popover.Content
            class="z-action-menu rounded-lg border border-edge bg-menu p-1 text-ink shadow-menu outline-none"
            onOpenAutoFocus={(event) => {
              event.preventDefault();
              searchInput?.focus();
            }}
            onCloseAutoFocus={keys.onCloseAutoFocus}
          >
            <OptionPicker
              column={props.column}
              selected={selected()}
              search={search()}
              onSearch={(value) => {
                setSearch(value);
                setError('');
              }}
              onPick={pick}
              onClear={() => {
                void props.onWrite(null);
                setOpen(false);
              }}
              onCreate={(value) => void create(value)}
              onKeyDown={tabAway}
              editing={editing}
              inputRef={(element) => {
                searchInput = element;
              }}
              error={error()}
            />
          </Popover.Content>
        </Popover.Portal>
      </Popover>
    </Show>
  );
}

/** Date cells edit through the shared property date selector. */
function DateCell(props: GridCellProps) {
  const opening = createEditorMeasurement(() => props.column.dataType);
  let openingEvent: Event | undefined;
  const [open, setOpen] = createSignal(false);
  const [query, setQuery] = createSignal('');
  const label = () => formatCellValue(props.column, props.value);
  // The selector mounts on first use; until then the cell is a plain button.
  const [mounted, setMounted] = createSignal(false);
  const edit = (seed?: string, event?: Event) => {
    openingEvent = undefined;
    opening.measure(
      () => {
        setQuery(seed ?? '');
        setMounted(true);
        setOpen(true);
      },
      event,
      !mounted()
    );
  };
  const keys = createPopupCellKeys({
    get onNavigate() {
      return props.onNavigate;
    },
    edit: (event) => edit(undefined, event),
    close: () => setOpen(false),
  });
  onMount(() => props.onReady?.({ focus: keys.focus, edit }));
  onCleanup(() => props.onReady?.(undefined));
  const trigger = {
    onPointerDown: (event: PointerEvent) => {
      openingEvent = event;
    },
    ref: keys.triggerRef,
    // A ghost button's look, on a plain button the cell can afford a thousand of.
    class:
      'relative inline-flex h-auto min-h-9 w-full min-w-0 items-center justify-start rounded border border-transparent px-2.5 py-1.5 text-left text-[13px] leading-5 font-normal whitespace-nowrap text-ink-muted outline-none hover:bg-hover hover:text-ink focus-visible:ring-2 focus-visible:ring-ink/50',
    get 'aria-label'() {
      return `${props.column.name}: ${label() || props.emptyLabel || 'Empty'}. Click to edit`;
    },
    onKeyDown: (event: KeyboardEvent) => {
      if (isComposingKey(event) || keys.tabFromTrigger(event)) return;
      if (event.key === 'Backspace' || event.key === 'Delete') {
        event.preventDefault();
        event.stopPropagation();
        void props.onWrite(null);
      } else if (
        event.key.length === 1 &&
        !event.ctrlKey &&
        !event.metaKey &&
        !event.altKey
      ) {
        event.preventDefault();
        event.stopPropagation();
        edit(event.key, event);
      }
    },
  };
  const shown = () => (
    <span class="truncate">
      {label() || (
        <span class="text-ink-placeholder opacity-40">
          {props.emptyLabel || '—'}
        </span>
      )}
    </span>
  );
  return (
    <Show
      when={mounted()}
      fallback={
        <button
          type="button"
          {...trigger}
          aria-haspopup="true"
          aria-expanded="false"
          onClick={(event) => edit(undefined, event)}
        >
          {shown()}
        </button>
      }
    >
      <Dropdown
        open={open()}
        onOpenChange={(value) => {
          if (value) {
            edit(undefined, openingEvent);
            openingEvent = undefined;
          } else setOpen(false);
        }}
      >
        <Dropdown.Trigger as="button" {...trigger}>
          {shown()}
        </Dropdown.Trigger>
        <Dropdown.Content
          class="flex max-h-96 w-70 flex-col overflow-hidden p-0 text-sm"
          // A menu's closing animation must not delay Tab into the next cell.
          style={{ animation: 'none' }}
          onKeyDown={(event: KeyboardEvent) => {
            if (event.key !== 'Tab' || event.isComposing) return;
            event.preventDefault();
            keys.leave(event.shiftKey ? -1 : 1);
          }}
          onCloseAutoFocus={keys.onCloseAutoFocus}
        >
          <PropertyDateSelector
            property={{ displayName: props.column.name }}
            selectedDate={fromCellDate(props.value)}
            initialQuery={query()}
            onSelectDate={(date) =>
              void props.onWrite(date ? toCellDate(date) : null)
            }
            onClose={() => setOpen(false)}
          />
        </Dropdown.Content>
      </Dropdown>
    </Show>
  );
}

/** Multi-line text keeps its arrows until the caret is on the first or last line. */
function caretOnEdgeLine(
  target: EventTarget | null,
  direction: 1 | -1
): boolean {
  if (target instanceof HTMLInputElement) return true;
  if (!(target instanceof HTMLElement)) return false;
  const selection = target.ownerDocument.getSelection();
  if (!selection?.rangeCount || !selection.isCollapsed) return false;
  const caret = selection.getRangeAt(0);
  const rest = target.ownerDocument.createRange();
  rest.selectNodeContents(target);
  if (direction === 1) rest.setStart(caret.endContainer, caret.endOffset);
  else rest.setEnd(caret.startContainer, caret.startOffset);
  return !rest.toString().includes('\n');
}
