import clickOutside from '@core/directive/clickOutside';
import { useCanEdit } from '@core/signal/permissions';
import { useIsKeyPressActive } from '@core/util/useIsKeyPressActive';
import { INSERT_TABLE_COMMAND } from '@lexical/table';
import { createCallback } from '@solid-primitives/rootless';
import { Layer } from '@ui';
import {
  createEffect,
  createSignal,
  Index,
  Show,
  untrack,
  useContext,
} from 'solid-js';
import {
  createMenuOpenSignal,
  MenuPriority,
} from '../../context/FloatingMenuContext';
import { LexicalWrapperContext } from '../../context/LexicalWrapperContext';
import { floatWithSelection } from '../../directive/floatWithSelection';
import { tablePickerPlugin } from '../../plugins';
import { useMenuKeyboardNavigation } from './useMenuKeyboardNavigation';

false && floatWithSelection;
false && clickOutside;

const DEFAULT_ROWS = 3;
const DEFAULT_COLS = 3;
// The grid starts MIN_GRID_SIZE cells square and grows a cell past the
// selection (Google Docs style) up to MAX_GRID_SIZE.
const MIN_GRID_SIZE = 6;
const MAX_GRID_SIZE = 12;

/**
 * Floating table size picker, opened via TRY_INSERT_TABLE_PICKER_COMMAND.
 * Arrow keys resize the selection, Enter inserts, Escape cancels. The mouse
 * can hover/click the grid as well. The editor keeps focus throughout.
 */
export function FloatingTableMenu() {
  const canEdit = useCanEdit();
  const lexicalWrapper = useContext(LexicalWrapperContext);
  const plugins = () => lexicalWrapper?.plugins;
  const editor = () => lexicalWrapper?.editor;

  const [menuOpen, setMenuOpen] = createMenuOpenSignal(
    'table-picker-menu',
    MenuPriority.Low,
    false
  );
  const [rows, setRows] = createSignal(DEFAULT_ROWS);
  const [cols, setCols] = createSignal(DEFAULT_COLS);

  const { isKeypressActive } = useIsKeyPressActive();

  const resetMenu = () => {
    setMenuOpen(false);
    setRows(DEFAULT_ROWS);
    setCols(DEFAULT_COLS);
  };

  const handleCreateTable = createCallback(() => {
    if (menuOpen()) {
      resetMenu();
      return;
    }
    // Defer past the current event: the keystroke that triggered the picker
    // is still mid-dispatch (microtask checkpoints run between document
    // listeners), and opening synchronously would let the picker's own
    // keydown listener treat that same Enter as a confirm.
    setTimeout(() => setMenuOpen(true), 0);
  });

  const insertTable = (rows: number, cols: number) => {
    editor()?.dispatchCommand(INSERT_TABLE_COMMAND, {
      columns: `${cols}`,
      rows: `${rows}`,
      includeHeaders: false,
    });
    resetMenu();
  };

  createEffect(() => {
    const currentPlugins = plugins();
    if (!currentPlugins) return;

    currentPlugins.useReactive(canEdit, () => {
      if (!canEdit()) return;
      return tablePickerPlugin({ onCreateTable: handleCreateTable });
    });
  });

  const visibleRows = () =>
    Math.max(MIN_GRID_SIZE, Math.min(MAX_GRID_SIZE, rows() + 1));
  const visibleCols = () =>
    Math.max(MIN_GRID_SIZE, Math.min(MAX_GRID_SIZE, cols() + 1));

  useMenuKeyboardNavigation({
    isActive: menuOpen,
    onUp: () => setRows((r) => Math.max(1, r - 1)),
    onDown: () => setRows((r) => Math.min(MAX_GRID_SIZE, r + 1)),
    onLeft: () => setCols((c) => Math.max(1, c - 1)),
    onRight: () => setCols((c) => Math.min(MAX_GRID_SIZE, c + 1)),
    onSelect: () => insertTable(rows(), cols()),
    onClose: () => {
      resetMenu();
      editor()?.focus();
    },
    onOtherKey: (e) => {
      // Typing dismisses the picker and the key goes to the editor.
      if (e.key.length === 1 || e.key === 'Backspace') {
        resetMenu();
      }
    },
  });

  const handleCellHover = (rowIndex: number, colIndex: number) => {
    if (isKeypressActive()) return;
    setRows(rowIndex + 1);
    setCols(colIndex + 1);
  };

  return (
    <Show when={menuOpen()}>
      {/* Same elevated surface as the other floating bars. */}
      <Layer depth={2}>
        <div
          class="p-2 fixed bg-surface top-0 left-0 z-action-menu rounded-lg shadow-lg ring-1 ring-edge cursor-default select-none"
          use:floatWithSelection={{
            selection: untrack(() => window.getSelection()),
            reactiveOnContainer: editor()?.getRootElement(),
          }}
          use:clickOutside={() => resetMenu()}
          on:mousedown={(e) => e.preventDefault()}
        >
          <div class="flex flex-col items-center gap-1.5">
            <div
              class="grid gap-1"
              style={{
                'grid-template-columns': `repeat(${visibleCols()}, 1fr)`,
              }}
            >
              <Index each={Array.from({ length: visibleRows() })}>
                {(_, rowIndex) => (
                  <Index each={Array.from({ length: visibleCols() })}>
                    {(_, colIndex) => (
                      <div
                        class="size-4 border border-edge rounded-xs transition-colors duration-100"
                        classList={{
                          'bg-accent/20 border-accent/50':
                            rowIndex < rows() && colIndex < cols(),
                        }}
                        onMouseOver={() => handleCellHover(rowIndex, colIndex)}
                        onClick={() => insertTable(rowIndex + 1, colIndex + 1)}
                      />
                    )}
                  </Index>
                )}
              </Index>
            </div>
            <p class="text-xs text-ink-muted">
              {rows()} &times; {cols()}
            </p>
          </div>
        </div>
      </Layer>
    </Show>
  );
}
