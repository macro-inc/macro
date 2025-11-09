import { TextButton } from '@core/component/TextButton';
import { INSERT_TABLE_COMMAND } from '@lexical/table';
import { createCallback } from '@solid-primitives/rootless';
import { createSignal, Index, type ParentProps } from 'solid-js';
import { Portal } from 'solid-js/web';
import { mdStore } from '../signal/markdownBlockData';

const MAX_NUMBER_OF_ROWS = 50;
const MAX_NUMBER_OF_COLS = 20;
const MAX_HOVER_GRID_SELECTION_SIZE = 12;

/**
 * TableGrid component for selecting table dimensions
 */
const TableGrid = ({
  handleInsertTable,
}: {
  handleInsertTable: (rows: number, cols: number) => void;
}) => {
  const [hoverPosition, setHoverPosition] = createSignal({
    row: 0,
    col: 0,
  });
  const [isHovering, setIsHovering] = createSignal(false);
  const [cursorPos, setCursorPos] = createSignal({
    x: 0,
    y: 0,
  });

  const handleMouseMove = (e: any) => {
    setCursorPos({
      x: e.clientX,
      y: e.clientY,
    });
  };

  const handleCellHover = (row: number, col: number) => {
    setHoverPosition({ row, col });
  };

  const handleCellClick = () => {
    const { row, col } = hoverPosition();
    handleInsertTable(row + 1, col + 1);
  };

  return (
    <div class="w-fit h-fit flex flex-col items-center rounded">
      <div
        class="relative p-1 my-1"
        onMouseEnter={() => setIsHovering(true)}
        onMouseLeave={() => setIsHovering(false)}
        onMouseMove={handleMouseMove}
      >
        <div
          class="grid gap-1"
          style={{
            'grid-template-columns': `repeat(${MAX_HOVER_GRID_SELECTION_SIZE}, 1fr)`,
          }}
        >
          <Index each={Array(MAX_HOVER_GRID_SELECTION_SIZE).fill(0)}>
            {(_, rowIndex) => (
              <Index each={Array(MAX_HOVER_GRID_SELECTION_SIZE).fill(0)}>
                {(_, colIndex) => {
                  const isHighlighted = () =>
                    isHovering() &&
                    rowIndex <= hoverPosition().row &&
                    colIndex <= hoverPosition().col;

                  return (
                    <div
                      class="w-4 h-4 border border-edge cursor-pointer transition-colors duration-100"
                      classList={{
                        'bg-hover': isHighlighted(),
                      }}
                      onMouseOver={() => handleCellHover(rowIndex, colIndex)}
                      onClick={handleCellClick}
                    />
                  );
                }}
              </Index>
            )}
          </Index>
        </div>

        {/* Size indicator tooltip */}
        {isHovering() && (
          <Portal>
            <div
              class="fixed bg-dialog text-ink text-xs px-2 py-1 rounded pointer-events-none"
              style={`left: ${cursorPos().x + 10}px; top: ${cursorPos().y + 10}px;`}
            >
              {hoverPosition().row + 1} × {hoverPosition().col + 1}
            </div>
          </Portal>
        )}
      </div>
    </div>
  );
};

/**
 * TableInsert component for inserting tables into the editor
 */
export function TableInsert(
  props: ParentProps<{
    onMenuClose?: () => void;
  }>
) {
  const mdData = mdStore.get;
  const editor = () => mdData.editor;

  const [rows, setRows] = createSignal<number>();
  const [cols, setCols] = createSignal<number>();

  const handleInsertTable = createCallback((rows: number, cols: number) => {
    if (rows <= 0 || cols <= 0) return;

    const _cols = Math.min(cols, MAX_NUMBER_OF_COLS);
    const _rows = Math.min(rows, MAX_NUMBER_OF_ROWS);
    editor()?.dispatchCommand(INSERT_TABLE_COMMAND, {
      columns: `${_cols}`,
      rows: `${_rows}`,
      includeHeaders: false,
    });
    setRows(undefined);
    setCols(undefined);
    if (props.onMenuClose) {
      props.onMenuClose();
    }
  });

  return (
    <div class="w-fit h-fit flex flex-col items-center justify-center rounded select-none border border-edge bg-dialog py-1 text-ink">
      <div class="w-full h-full mx-2 flex justify-center rounded">
        <TableGrid handleInsertTable={handleInsertTable} />
      </div>
      <div class="w-full h-full flex px-1.5 items-center justify-between">
        <div class="w-18 h-10 p-1.5 text-ink">
          <input
            type="number"
            class="w-full h-full p-2 border border-edge text-sm rounded"
            placeholder="rows"
            value={`${rows()}`}
            onInput={(e) => setRows(Number(e.target.value))}
            on:focus={(e) => e.stopPropagation()}
            on:blur={(e) => e.stopPropagation()}
          />
        </div>
        <span class="text-ink-extra-muted">&times;</span>
        <div class="w-18 h-10 p-1.5 text-ink">
          <input
            type="number"
            class="w-full h-full p-2 border border-edge bg-input text-sm rounded"
            placeholder="cols"
            value={`${cols()}`}
            onInput={(e) => setCols(Number(e.target.value))}
            on:focus={(e) => e.stopPropagation()}
            on:blur={(e) => e.stopPropagation()}
          />
        </div>
        <TextButton
          text="Insert Table"
          theme="base"
          disabled={!rows() || !cols()}
          onClick={() => handleInsertTable(rows() ?? 0, cols() ?? 0)}
        />
      </div>
    </div>
  );
}
