import type { FormatMenuHost } from '@core/component/LexicalMarkdown/editing/overlay-hosts/format';
import { createNativeListenerScope } from '@core/component/LexicalMarkdown/editing/overlay-hosts/native-listeners';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { fireAndForget } from '@core/util/fireAndForget';
import type {
  EditorView,
  LatestPublishedObserver,
} from '@macro-inc/lexical-wasm-view';
import { createViewCommand } from '@macro-inc/lexical-wasm-view/view/commands';
import type { InputSettlement } from '@macro-inc/lexical-wasm-view/view/port';
import {
  isSelectionWithinEditor,
  sameSelection,
} from '@macro-inc/lexical-wasm-view/view/selection';
import type { ViewSelection } from '@macro-inc/lexical-wasm-view/view/types';
import type { Accessor } from 'solid-js';
import { createSignal } from 'solid-js';
import { createNativeFormattingActions } from './native-actions';
import type { NativeDocumentLinkMenuHost } from './native-link-host';
import {
  readNativeFormattingSelection,
  readNativeSelectionText,
} from './native-selection';
import {
  type NativeFormattingTableFacts,
  readNativeFormattingTableFacts,
} from './native-table-facts';
import type { BodyFormattingPopupHost, DocumentFormattingHost } from './types';

const escapeCommand = createViewCommand(
  'Key(Escape)',
  (value): value is KeyboardEvent | null =>
    value === null || value instanceof KeyboardEvent
);

function cellAndTable(view: EditorView, key: number) {
  let cell: number | undefined;
  let node = view.mirror.node(key);
  while (node) {
    if (cell === undefined && node.type === 'tablecell') cell = node.key;
    if (node.type === 'table') return { cell, table: node.key };
    node = node.parent === null ? null : view.mirror.node(node.parent);
  }
  return undefined;
}

/** One actual view's formatting requests and acknowledged presentation facts. */
export function createNativeDocumentFormattingHost(
  view: EditorView,
  options: {
    canEdit: Accessor<boolean>;
    alive: Accessor<boolean>;
    links: NativeDocumentLinkMenuHost;
    /** Source popupPlugin `$allowEmptySelection`: on a touch device, whether a
     *  range selection with no text still shows the popup. Called with the
     *  selection of the commit being decided on. */
    allowEmptySelection?: (selection: ViewSelection) => boolean;
  }
) {
  const scope = createNativeListenerScope();
  let disposed = false;
  let terminal = false;
  const active = () => !disposed && options.alive() && view.isMounted;
  const own = (cleanup: () => void, native = false) => {
    const release = () => {
      if (!native || !terminal) cleanup();
    };
    if (disposed) release();
    else scope.add(release);
  };
  const actions = createNativeFormattingActions(view, options.canEdit, active);
  if (!view.port.nativeEnter || !view.port.nativeEscape)
    throw new Error(
      'Native formatting menus require ordered Enter and Escape ports'
    );
  const [selection, setSelection] =
    createSignal<ReturnType<typeof readNativeFormattingSelection>>();
  const [tables, setTables] = createSignal<{
    selectedCells: readonly number[] | null;
    canMerge: boolean;
    canSplit: boolean;
  }>();
  const [canConvertList, setCanConvertList] = createSignal(false);
  let selectionText = '';
  const [text, setText] = createSignal('');
  let previousSelection: ViewSelection | undefined;
  let previousGeneration: number | null = null;
  const [focused, setFocused] = createSignal(
    view.root.contains(view.root.ownerDocument.activeElement)
  );
  const [editable, setEditable] = createSignal(view.isEditable);
  const transforms = new Set<() => boolean>();
  let popup: Parameters<FormatMenuHost['registerPopup']>[0] | undefined;
  const complete = async (result: Promise<InputSettlement>) => {
    const settled = await result;
    if (settled.status === 'error') throw settled.error;
  };
  const focusIn = () => setFocused(true);
  const focusOut = (event: FocusEvent) =>
    setFocused(
      event.relatedTarget instanceof Node &&
        view.root.contains(event.relatedTarget)
    );
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    const currentPopup = popup;
    popup = undefined;
    transforms.clear();
    scope.add(() => currentPopup?.visible(false));
    scope.add(() => setSelection(undefined));
    scope.add(() => setTables(undefined));
    scope.add(() => setCanConvertList(false));
    scope.add(() => setText(''));
    scope.dispose();
  };

  try {
    view.root.addEventListener('focusin', focusIn);
    own(() => view.root.removeEventListener('focusin', focusIn));
    view.root.addEventListener('focusout', focusOut);
    own(() => view.root.removeEventListener('focusout', focusOut));
    own(view.onEditableChange(setEditable));

    const readTables = () => {
      const selected = view.selection().selection;
      const address =
        selected.kind === 'table'
          ? { table: selected.table, cell: undefined }
          : selected.kind === 'range'
            ? cellAndTable(view, selected.anchor.key)
            : undefined;
      if (!address) return undefined;
      const facts = readNativeFormattingTableFacts(view, address.table);
      const byTable = new Map<number, NativeFormattingTableFacts>([
        [address.table, facts],
      ]);
      const span = (key: number) => {
        const existing = facts.cells.get(key);
        if (existing) return existing;
        const owner = cellAndTable(view, key);
        if (!owner || owner.cell !== key)
          throw new Error('Native formatting cell owner is unavailable');
        let actual = byTable.get(owner.table);
        if (!actual) {
          actual = readNativeFormattingTableFacts(view, owner.table);
          byTable.set(owner.table, actual);
        }
        const cell = actual.cells.get(key);
        if (!cell)
          throw new Error('Native formatting cell span is unavailable');
        return cell;
      };
      const cells =
        selected.kind === 'table'
          ? (() => {
              if (facts.selectedCellKeys === null)
                throw new Error('Native table selection facts are unavailable');
              return facts.selectedCellKeys;
            })()
          : address.cell === undefined
            ? []
            : [address.cell];
      return {
        selectedCells: facts.selectedCellKeys,
        canMerge:
          selected.kind === 'table' &&
          facts.selectedCellKeys !== null &&
          facts.selectedCellKeys.length > 1,
        canSplit: cells.some((key) => {
          const cell = span(key);
          return cell.rowSpan > 1 || cell.colSpan > 1;
        }),
      };
    };

    const rectangle = (): DOMRect | undefined => {
      if (!active()) return undefined;
      const current = view.selection().selection;
      if (current.kind === 'range') {
        const dom = view.root.ownerDocument.getSelection();
        if (
          !dom ||
          dom.rangeCount === 0 ||
          !isSelectionWithinEditor(view, dom.anchorNode, dom.focusNode)
        )
          return undefined;
        return dom.getRangeAt(0).getBoundingClientRect();
      }
      if (current.kind !== 'table') return undefined;
      // Source popupPlugin uses the first/last cells in actual TableSelection order.
      const cells = (tables()?.selectedCells ?? [])
        .map((key) => view.getElementByKey(key))
        .filter((element) => element !== null);
      const first = cells[0];
      const last = cells.at(-1);
      if (!first || !last) return undefined;
      const a = first.getBoundingClientRect();
      const b = last.getBoundingClientRect();
      return new DOMRect(a.left, a.top, b.right - a.left, b.bottom - a.top);
    };
    const updatePopup = () => {
      if (!popup) return;
      popup.visible(false);
      const current = view.selection().selection;
      if (!active()) return;
      if (current.kind === 'table') {
        if (isTouchDevice()) return;
        const cells = tables()?.selectedCells;
        if (!cells?.some((key) => view.getElementByKey(key))) return;
        if (popup.visible(true)) popup.selection(undefined);
        return;
      }
      if (current.kind !== 'range') return;
      // Source popupPlugin :190-195: an empty-text range shows only through
      // $allowEmptySelection, which MarkdownPopup supplies on touch only.
      if (
        selectionText.length === 0 &&
        !(isTouchDevice() && options.allowEmptySelection?.(current))
      )
        return;
      const dom = view.root.ownerDocument.getSelection();
      if (!dom || dom.rangeCount === 0) return;
      if (popup.visible(true)) popup.selection(dom);
    };
    // Source popupPlugin hides and re-requests the popup on every
    // SELECTION_CHANGE, which onSelectionChange dispatches for each
    // selectionchange in the editor, so the popup's 100 ms debounce never
    // elapses while a drag keeps moving the DOM caret. A native TableSelection
    // stays through those carets without a publication, so restart it here,
    // for the selections Lexical dispatches it for: both endpoints owned by
    // this editor, never a nested editor's or a decorator input's.
    const doc = view.root.ownerDocument;
    const tableSelectionChange = () => {
      if (!active() || view.selection().selection.kind !== 'table') return;
      const dom = doc.getSelection();
      if (!dom || !isSelectionWithinEditor(view, dom.anchorNode, dom.focusNode))
        return;
      updatePopup();
    };
    doc.addEventListener('selectionchange', tableSelectionChange);
    own(() => doc.removeEventListener('selectionchange', tableSelectionChange));
    const observer: LatestPublishedObserver = {
      published(actual) {
        if (!active()) return;
        if (actual !== view)
          throw new Error('Formatting observer belongs to another view');
        const selected = readNativeFormattingSelection(view);
        const table = readTables();
        const convertible = actions.canConvertList();
        const textSelection = view.selection().selection;
        // Source popupPlugin takes getTextContent() of a range or a
        // TableSelection; MarkdownPopup's Task action keys off that text.
        selectionText =
          textSelection.kind === 'table' ||
          (textSelection.kind === 'range' &&
            (textSelection.anchor.key !== textSelection.focus.key ||
              textSelection.anchor.offset !== textSelection.focus.offset ||
              textSelection.anchor.type !== textSelection.focus.type))
            ? readNativeSelectionText(view)
            : '';
        setText(selectionText);
        setSelection(selected);
        setTables(table);
        setCanConvertList(convertible);
        const current = view.selection().selection;
        if (
          previousGeneration !== view.mirror.keyGeneration ||
          !previousSelection ||
          !sameSelection(previousSelection, current)
        )
          updatePopup();
        previousSelection = current;
        previousGeneration = view.mirror.keyGeneration;
      },
      unavailable() {
        terminal = true;
        dispose();
      },
      retired() {
        terminal = true;
        dispose();
      },
    };

    const host: DocumentFormattingHost = {
      selection,
      focused,
      editable: () => active() && editable(),
      interactable: () => active() && options.canEdit() && editable(),
      root: () => (active() ? view.root : null),
      focus() {
        if (active()) view.focus();
      },
      formatText(format) {
        fireAndForget(complete(actions.text(format)), 'markdown-format-text');
      },
      formatBlock(format) {
        for (const listener of [...transforms]) listener();
        fireAndForget(complete(actions.block(format)), 'markdown-format-block');
      },
      requestLink: options.links.requestLink,
      unlink: options.links.unlink,
      tables: {
        canMerge: () => tables()?.canMerge ?? false,
        canSplit: () => tables()?.canSplit ?? false,
        merge() {
          fireAndForget(
            complete(actions.mergeTableSelection()),
            'markdown-table-merge'
          );
        },
        split() {
          fireAndForget(
            complete(actions.splitTableSelection()),
            'markdown-table-split'
          );
        },
        insert(rows, columns) {
          fireAndForget(
            complete(actions.insertTable(rows, columns)),
            'markdown-table-insert'
          );
        },
        canConvertList: () => active() && canConvertList(),
        convertList(after) {
          fireAndForget(
            actions.convertList().then((result) => {
              if (result.status === 'error') throw result.error;
              after(result.status === 'success' && result.handled);
            }),
            'markdown-list-to-table'
          );
        },
      },
    };

    const menu: FormatMenuHost = {
      selection,
      isInteractable: host.interactable,
      root: host.root,
      focus: host.focus,
      formatText: host.formatText,
      formatBlock: host.formatBlock,
      requestLink: host.requestLink,
      unlink: host.unlink,
      registerPopup(callbacks) {
        if (disposed || popup)
          throw new Error('Native formatting popup is unavailable');
        popup = callbacks;
        updatePopup();
      },
      registerListeners(callbacks) {
        const out = (event: FocusEvent) =>
          callbacks.focusOut(event.relatedTarget);
        view.root.addEventListener('focusout', out);
        own(() => view.root.removeEventListener('focusout', out));
        transforms.add(callbacks.transform);
        own(() => transforms.delete(callbacks.transform));
        own(
          view.registerViewCommand(
            escapeCommand,
            () => active() && callbacks.escape(),
            3
          ),
          true
        );
      },
    };
    const bodyPopup: BodyFormattingPopupHost = {
      rectangle,
      selectionText: text,
      captureLink() {
        const target = actions.captureLinkTarget();
        return {
          insert(url) {
            // Source linkText, read at submit: `selection()?.text ?? input`. An
            // empty selection text stays empty; only a missing selection falls
            // back to the raw typed input.
            const label =
              view.selection().selection.kind === 'none' ? url : selectionText;
            fireAndForget(
              complete(target.insert(url, label)),
              'markdown-link-insert'
            );
          },
        };
      },
      registerPopup: menu.registerPopup,
      registerListeners: menu.registerListeners,
    };
    return { host, menu, bodyPopup, observer, dispose };
  } catch (error) {
    disposed = true;
    return scope.fail(error);
  }
}
