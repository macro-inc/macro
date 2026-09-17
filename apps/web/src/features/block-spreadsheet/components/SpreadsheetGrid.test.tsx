import { cleanup, fireEvent, render } from '@solidjs/testing-library';
import { type Accessor, type ComponentProps, createSignal } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SpreadsheetCells } from '../core/spreadsheet-document';
import {
  createGridController,
  type GridController,
} from '../primitives/create-grid-controller';
import { SpreadsheetGrid } from './SpreadsheetGrid';
import { FormulaBar } from './SpreadsheetToolbar';

// The formula bar shares a module with toolbar buttons; their app hotkey
// infrastructure is not mounted by this editor interaction fixture.
vi.mock('@ui/components/Button', () => ({ Button: () => null }));

// jsdom has no viewport. Give the row window a deterministic visible height.
vi.mock('@solid-primitives/resize-observer', () => ({
  createElementSize: () => ({ width: 1000, height: 960 }),
}));
afterEach(cleanup);

function renderGrid(
  initial: SpreadsheetCells = {},
  options: Pick<
    ComponentProps<typeof SpreadsheetGrid>,
    | 'zoom'
    | 'showGridlines'
    | 'showFormulas'
    | 'columnWidths'
    | 'rowCount'
    | 'sheetId'
    | 'onFill'
    | 'onResizeColumn'
  > & {
    values?: ComponentProps<typeof SpreadsheetGrid>['values'];
    readonly?: boolean;
  } = {}
) {
  let controller!: GridController;
  let cells!: Accessor<SpreadsheetCells>;
  const onPaste = vi.fn((text: string) => controller.paste(text));
  const onClear = vi.fn(() => controller.clear());
  const onCopy = vi.fn(() => controller.copy());
  const onCopyMetadata = vi.fn((cut?: boolean) => controller.copyMetadata(cut));
  const onMove = vi.fn((row: number, column: number) =>
    controller.move(row, column)
  );
  const view = render(() => {
    const [values, setValues] = createSignal(initial);
    cells = values;
    controller = createGridController({
      cells,
      sheetId: () => options.sheetId ?? 'sheet1',
      canEdit: () => !options.readonly,
      setCells: (edits) => {
        const next = { ...values() };
        for (const [address, edit] of Object.entries(edits)) {
          if (edit === null) delete next[address];
          else next[address] = { ...(next[address] ?? { value: '' }), ...edit };
        }
        setValues(next);
      },
      undo: () => {},
      redo: () => {},
    });
    return (
      <>
        <FormulaBar
          address={controller.activeAddress()}
          value={
            controller.editing()
              ? controller.draft()
              : (cells()[controller.activeAddress()]?.value ?? '')
          }
          readonly={options.readonly ?? false}
          complete={async () => undefined}
          selectionRequest={controller.editorSelection()}
          pickingReference={controller.pickingReference()}
          onSelectionChange={controller.setTextSelection}
          onNavigate={() => {}}
          onEdit={() => controller.beginEdit('formula')}
          onInput={controller.setDraft}
          onCommit={controller.commit}
          onCancel={controller.cancel}
          onReturnToGrid={() => {}}
        />
        <SpreadsheetGrid
          cells={cells()}
          sheetId={options.sheetId}
          rowCount={options.rowCount ?? 30}
          zoom={options.zoom}
          showGridlines={options.showGridlines}
          showFormulas={options.showFormulas}
          columnWidths={options.columnWidths}
          onFill={options.onFill}
          onResizeColumn={options.onResizeColumn}
          values={options.values ?? {}}
          remoteCursors={[]}
          selection={controller.selection()}
          editing={controller.editing() === 'cell'}
          formulaEditing={controller.editing() === 'formula'}
          editorSelection={controller.editorSelection()}
          referenceSelection={controller.referenceSelection()}
          pickingReference={controller.pickingReference()}
          onTextSelection={controller.setTextSelection}
          onReferenceStart={controller.beginReference}
          onReferenceMove={controller.updateReference}
          onReferenceEnd={controller.endReference}
          draft={controller.draft()}
          readonly={options.readonly ?? false}
          onSelect={controller.select}
          onSelectRange={controller.selectRange}
          onEdit={() => controller.beginEdit('cell')}
          onDraft={controller.setDraft}
          onCommit={controller.commit}
          onCancel={controller.cancel}
          onMove={onMove}
          onKeyDown={controller.keyDown}
          onCopy={onCopy}
          onCopyMetadata={onCopyMetadata}
          onPaste={onPaste}
          onClear={onClear}
          onGridReady={() => {}}
        />
      </>
    );
  });
  const element = view.getByRole('grid');
  // jsdom has no layout or scrolling; only the selected cells need this DOM API.
  for (const address of ['A1', 'A2']) {
    const cell = view.container.querySelector<HTMLElement>(
      `[data-address="${address}"]`
    );
    if (cell) cell.scrollIntoView = vi.fn();
  }
  return {
    ...view,
    element,
    controller,
    cells,
    onPaste,
    onClear,
    onMove,
    onCopy,
    onCopyMetadata,
  };
}

function clipboardEvent(
  type: 'paste' | 'cut',
  data: {
    types: string[];
    getData: () => string;
    setData?: (format: string, value: string) => void;
  } | null
): Event {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'clipboardData', { value: data });
  return event;
}

function touchPointer(
  target: Element | Window,
  type: string,
  x = 196,
  y = 55,
  pointerId = 1
) {
  const event = new MouseEvent(type, {
    button: 0,
    buttons: type === 'pointerup' ? 0 : 1,
    clientX: x,
    clientY: y,
    bubbles: true,
    cancelable: true,
  });
  Object.defineProperties(event, {
    pointerType: { value: 'touch' },
    pointerId: { value: pointerId },
    isPrimary: { value: true },
  });
  fireEvent(target, event);
  return event;
}

describe('spreadsheet touch gestures', () => {
  it('waits for a tap and leaves swipes and cancelled gestures to native scrolling', () => {
    const view = renderGrid();
    const cell = view.getByRole('gridcell', { name: 'B2' });
    expect(touchPointer(cell, 'pointerdown').defaultPrevented).toBe(false);
    expect(view.controller.activeAddress()).toBe('A1');
    expect(touchPointer(window, 'pointermove', 196, 100).defaultPrevented).toBe(
      false
    );
    touchPointer(window, 'pointerup', 196, 100);
    expect(view.controller.activeAddress()).toBe('A1');

    touchPointer(cell, 'pointerdown');
    touchPointer(window, 'pointercancel');
    touchPointer(window, 'pointerup');
    expect(view.controller.activeAddress()).toBe('A1');

    touchPointer(cell, 'pointerdown');
    touchPointer(window, 'pointerup');
    expect(view.controller.activeAddress()).toBe('B2');
    expect(view.controller.editing()).toBeUndefined();
    expect(
      view.getByRole('button', { name: 'Move selection end' })
    ).toBeTruthy();
  });

  it('edits on a second tap and cancels iOS compatibility focus transfer', () => {
    const view = renderGrid({ B2: { value: 'original' } });
    const cell = view.getByRole('gridcell', { name: 'B2: original' });
    for (let tap = 0; tap < 2; tap++) {
      touchPointer(cell, 'pointerdown');
      touchPointer(window, 'pointerup');
    }
    const editor = view.getByRole('textbox', { name: 'Edit B2' });
    const compatibility = new MouseEvent('mousedown', {
      bubbles: true,
      cancelable: true,
    });
    fireEvent(cell, compatibility);
    expect(compatibility.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(editor);
    expect(view.cells().B2.value).toBe('original');
  });

  it('moves selection handles by coordinates even when touch capture keeps targeting the handle', () => {
    const view = renderGrid();
    view.element.setPointerCapture = vi.fn();
    const cell = view.getByRole('gridcell', { name: 'B2' });
    touchPointer(cell, 'pointerdown');
    touchPointer(window, 'pointerup');
    const handle = view.getByRole('button', { name: 'Move selection end' });
    expect(touchPointer(handle, 'pointerdown', 246, 66).defaultPrevented).toBe(
      true
    );
    touchPointer(handle, 'pointermove', 296, 97);
    touchPointer(window, 'pointerup', 296, 97);
    expect(view.controller.selection()).toEqual({
      anchor: { row: 1, column: 1 },
      focus: { row: 3, column: 2 },
    });
    expect(document.activeElement).toBe(view.element);
    expect(view.element.setPointerCapture).toHaveBeenCalledWith(1);
  });

  it('lets a tap in the handle padding select the cell underneath', () => {
    const view = renderGrid();
    view.element.setPointerCapture = vi.fn();
    const cell = view.getByRole('gridcell', { name: 'B2' });
    touchPointer(cell, 'pointerdown');
    touchPointer(window, 'pointerup');
    const handle = view.getByRole('button', { name: 'Move selection end' });
    // B2's handle is centered at (246, 66); its 44px grip overlaps C3.
    touchPointer(handle, 'pointerdown', 255, 76);
    touchPointer(window, 'pointerup', 255, 76);
    expect(view.controller.activeAddress()).toBe('C3');
    expect(view.controller.editing()).toBeUndefined();
  });

  it('does not start edge scrolling until a handle actually moves', () => {
    const view = renderGrid();
    view.element.setPointerCapture = vi.fn();
    touchPointer(view.getByRole('gridcell', { name: 'B2' }), 'pointerdown');
    touchPointer(window, 'pointerup');
    const requestFrame = vi.spyOn(window, 'requestAnimationFrame');
    try {
      touchPointer(
        view.getByRole('button', { name: 'Move selection start' }),
        'pointerdown',
        146,
        45
      );
      touchPointer(window, 'pointermove', 147, 45);
      expect(requestFrame).not.toHaveBeenCalled();
      touchPointer(window, 'pointerup', 147, 45);
      expect(view.controller.selection()).toEqual({
        anchor: { row: 1, column: 1 },
        focus: { row: 1, column: 1 },
      });
    } finally {
      requestFrame.mockRestore();
    }
  });

  it('cancels a pending tap when zoom or remote column geometry changes', () => {
    const [zoom, setZoom] = createSignal(100);
    const [columnWidths, setWidths] = createSignal<Record<number, number>>({});
    const view = renderGrid(
      {},
      {
        get zoom() {
          return zoom();
        },
        get columnWidths() {
          return columnWidths();
        },
      }
    );
    const cell = view.getByRole('gridcell', { name: 'B2' });
    touchPointer(cell, 'pointerdown');
    setZoom(150);
    touchPointer(window, 'pointerup');
    expect(view.controller.activeAddress()).toBe('A1');
    touchPointer(cell, 'pointerdown');
    setWidths({ 0: 300 });
    touchPointer(window, 'pointerup');
    expect(view.controller.activeAddress()).toBe('A1');
  });

  it.each(['cell', 'formula'] as const)(
    'extends a tapped reference with a handle while keeping the %s editor focused',
    (location) => {
      const view = renderGrid();
      view.element.setPointerCapture = vi.fn();
      if (location === 'cell') fireEvent.keyDown(view.element, { key: 'F2' });
      const editor = view.getByRole('textbox', {
        name: location === 'cell' ? 'Edit A1' : 'Formula bar',
      }) as HTMLTextAreaElement;
      editor.focus();
      fireEvent.input(editor, { target: { value: '=SUM(' } });
      editor.setSelectionRange(5, 5);
      fireEvent.select(editor);
      const cell = view.getByRole('gridcell', { name: 'B2' });
      touchPointer(cell, 'pointerdown');
      touchPointer(window, 'pointerup');
      expect(editor.value).toBe('=SUM(B2');
      const handle = view.getByRole('button', { name: 'Move reference end' });
      touchPointer(handle, 'pointerdown', 246, 66);
      touchPointer(handle, 'pointermove', 296, 97);
      touchPointer(window, 'pointerup', 296, 97);
      fireEvent.mouseDown(handle);
      expect(document.activeElement).toBe(editor);
      expect(editor.value).toBe('=SUM(B2:C4');
      expect(view.controller.activeAddress()).toBe('A1');
      expect(view.cells().A1).toBeUndefined();
    }
  );

  it('cancels pending taps and handles when switching sheets, and never edits for viewers', () => {
    const [sheetId, setSheetId] = createSignal('before');
    const view = renderGrid(
      {},
      {
        readonly: true,
        get sheetId() {
          return sheetId();
        },
      }
    );
    const cell = view.getByRole('gridcell', { name: 'B2' });
    touchPointer(cell, 'pointerdown');
    setSheetId('after');
    touchPointer(window, 'pointerup');
    expect(view.controller.activeAddress()).toBe('A1');
    for (let tap = 0; tap < 2; tap++) {
      touchPointer(cell, 'pointerdown');
      touchPointer(window, 'pointerup');
    }
    expect(view.controller.activeAddress()).toBe('B2');
    expect(view.controller.editing()).toBeUndefined();
    view.element.setPointerCapture = vi.fn();
    touchPointer(
      view.getByRole('button', { name: 'Move selection end' }),
      'pointerdown',
      246,
      66
    );
    setSheetId('final');
    touchPointer(window, 'pointermove', 296, 97);
    touchPointer(window, 'pointerup', 296, 97);
    expect(view.controller.activeAddress()).toBe('A1');
  });
});

describe('spreadsheet pointer gestures across sheet changes', () => {
  it('cancels a pending fill when its sheet disappears and allows a new fill', () => {
    const [sheetId, setSheetId] = createSignal('deleted');
    const onFill = vi.fn();
    const view = renderGrid(
      {},
      {
        get sheetId() {
          return sheetId();
        },
        onFill,
      }
    );
    const handle = view.getByRole('button', { name: 'Drag to fill selection' });
    const startFill = () =>
      fireEvent(
        handle,
        new MouseEvent('pointerdown', {
          button: 0,
          buttons: 1,
          bubbles: true,
          cancelable: true,
        })
      );
    const enter = (address: string) =>
      fireEvent(
        view.getByRole('gridcell', { name: address }),
        new MouseEvent('pointerenter', { buttons: 1 })
      );
    startFill();
    enter('A3');
    expect(
      view.container.querySelectorAll('[role="gridcell"][aria-selected="true"]')
    ).toHaveLength(3);

    setSheetId('retained');
    enter('A4');
    fireEvent(window, new MouseEvent('pointerup', { button: 0 }));
    expect(onFill).not.toHaveBeenCalled();
    expect(
      view.container.querySelectorAll('[role="gridcell"][aria-selected="true"]')
    ).toHaveLength(1);

    startFill();
    enter('A2');
    fireEvent(window, new MouseEvent('pointerup', { button: 0 }));
    expect(onFill).toHaveBeenCalledExactlyOnceWith(
      { anchor: { row: 0, column: 0 }, focus: { row: 0, column: 0 } },
      { anchor: { row: 0, column: 0 }, focus: { row: 1, column: 0 } }
    );
  });

  it('cancels an in-progress resize without carrying its width into the next sheet', () => {
    const [sheetId, setSheetId] = createSignal('deleted');
    const onResizeColumn = vi.fn();
    const view = renderGrid(
      {},
      {
        get sheetId() {
          return sheetId();
        },
        get columnWidths() {
          return { 0: sheetId() === 'deleted' ? 120 : 200 };
        },
        onResizeColumn,
      }
    );
    const handle = view.getByRole('separator', { name: 'Resize column A' });
    handle.setPointerCapture = vi.fn();
    const pointer = (type: string, clientX: number) =>
      fireEvent(
        handle,
        new MouseEvent(type, {
          button: 0,
          buttons: 1,
          clientX,
          bubbles: true,
          cancelable: true,
        })
      );
    const cell = view.getByRole('gridcell', { name: 'A1' });
    pointer('pointerdown', 100);
    pointer('pointermove', 160);
    expect(cell.style.width).toBe('180px');

    setSheetId('retained');
    pointer('pointermove', 180);
    fireEvent(window, new MouseEvent('pointerup', { button: 0 }));
    expect(onResizeColumn).not.toHaveBeenCalled();
    expect(cell.style.width).toBe('200px');

    pointer('pointerdown', 100);
    pointer('pointermove', 116);
    fireEvent(window, new MouseEvent('pointerup', { button: 0 }));
    expect(onResizeColumn).toHaveBeenCalledExactlyOnceWith(0, 216);
  });

  it('ends selection dragging at the sheet boundary', () => {
    const [sheetId, setSheetId] = createSignal('deleted');
    const view = renderGrid(
      {},
      {
        get sheetId() {
          return sheetId();
        },
      }
    );
    fireEvent(
      view.getByRole('gridcell', { name: 'B2' }),
      new MouseEvent('pointerdown', {
        button: 0,
        buttons: 1,
        bubbles: true,
        cancelable: true,
      })
    );
    fireEvent(
      view.getByRole('gridcell', { name: 'C3' }),
      new MouseEvent('pointerenter', { buttons: 1 })
    );
    expect(view.controller.selection().focus).toEqual({ row: 2, column: 2 });

    setSheetId('retained');
    fireEvent(
      view.getByRole('gridcell', { name: 'D4' }),
      new MouseEvent('pointerenter', { buttons: 1 })
    );
    fireEvent(window, new MouseEvent('pointerup', { button: 0 }));
    expect(view.controller.selection()).toEqual({
      anchor: { row: 0, column: 0 },
      focus: { row: 0, column: 0 },
    });
  });
});

describe('spreadsheet grid clipboard and editing', () => {
  it('copies instead of marking formulas as moved when a viewer uses cut', () => {
    const view = renderGrid({ A1: { value: '=B1' } }, { readonly: true });
    const setData = vi.fn();
    fireEvent(
      view.element,
      clipboardEvent('cut', { types: [], getData: () => '', setData })
    );
    expect(view.onCopy).toHaveBeenCalledWith(false);
    expect(view.onCopyMetadata).toHaveBeenCalledWith(false);
    expect(view.onClear).not.toHaveBeenCalled();
    expect(view.cells().A1.value).toBe('=B1');
    const metadata = JSON.parse(setData.mock.calls[1][1]);
    expect(metadata.cut).toBeUndefined();
    expect(metadata.cells[0][0].value).toBe('=B1');
  });

  it('does not erase content for image paste or a cut without a clipboard', () => {
    const view = renderGrid({ A1: { value: 'preserve me' } });
    fireEvent(
      view.element,
      clipboardEvent('paste', { types: ['Files'], getData: () => '' })
    );
    fireEvent(view.element, clipboardEvent('cut', null));
    expect(view.onPaste).not.toHaveBeenCalled();
    expect(view.onClear).not.toHaveBeenCalled();
    expect(view.cells().A1.value).toBe('preserve me');

    // A deliberately copied blank cell remains a valid paste operation.
    fireEvent(
      view.element,
      clipboardEvent('paste', { types: ['text/plain'], getData: () => '' })
    );
    expect(view.onPaste).toHaveBeenCalledWith('', undefined);
    expect(view.cells().A1.value).toBe('');
  });

  it('preserves multiline input and focus while editing, then commits on Enter', () => {
    const view = renderGrid({ A1: { value: 'line\nbreak' } });
    fireEvent.keyDown(view.element, { key: 'F2' });
    const editor = view.getByRole('textbox', { name: 'Edit A1' });
    expect(editor).toBeInstanceOf(HTMLTextAreaElement);
    expect(document.activeElement).toBe(editor);
    expect((editor as HTMLTextAreaElement).value).toBe('line\nbreak');
    fireEvent.input(editor, { target: { value: 'line\nbreak!' } });
    expect(view.getByRole('textbox', { name: 'Edit A1' })).toBe(editor);
    expect(document.activeElement).toBe(editor);
    expect(view.controller.draft()).toBe('line\nbreak!');

    const newline = new KeyboardEvent('keydown', {
      key: 'Enter',
      altKey: true,
      bubbles: true,
      cancelable: true,
    });
    fireEvent(editor, newline);
    expect(newline.defaultPrevented).toBe(false);
    expect(view.cells().A1.value).toBe('line\nbreak');
    expect(view.onMove).not.toHaveBeenCalled();

    fireEvent.keyDown(editor, { key: 'Enter' });
    expect(view.cells().A1.value).toBe('line\nbreak!');
    expect(view.controller.activeAddress()).toBe('A2');
    expect(document.activeElement).toBe(view.element);
    expect(view.queryByRole('textbox', { name: 'Edit A1' })).toBeNull();
  });

  it('leaves textarea clipboard events native and restores grid focus on Escape', () => {
    const view = renderGrid({ A1: { value: 'original\ntext' } });
    fireEvent.keyDown(view.element, { key: 'F2' });
    const editor = view.getByRole('textbox', { name: 'Edit A1' });
    const paste = clipboardEvent('paste', {
      types: ['text/plain'],
      getData: () => 'inside editor',
    });
    fireEvent(editor, paste);
    expect(paste.defaultPrevented).toBe(false);
    expect(view.onPaste).not.toHaveBeenCalled();
    fireEvent.input(editor, { target: { value: 'discard this' } });
    fireEvent.keyDown(editor, { key: 'Escape' });
    expect(view.cells().A1.value).toBe('original\ntext');
    expect(document.activeElement).toBe(view.element);
    expect(view.queryByRole('textbox', { name: 'Edit A1' })).toBeNull();
  });
});

it.each(['cell', 'formula'] as const)(
  'keeps the %s editor focused and inserts a dragged range at its caret',
  (location) => {
    const view = renderGrid();
    let editor: HTMLTextAreaElement;
    if (location === 'cell') {
      fireEvent.keyDown(view.element, { key: 'F2' });
      editor = view.getByRole('textbox', {
        name: 'Edit A1',
      }) as HTMLTextAreaElement;
    } else {
      editor = view.getByRole('textbox', {
        name: 'Formula bar',
      }) as HTMLTextAreaElement;
      editor.focus();
    }
    fireEvent.input(editor, { target: { value: '=SUM(,D1)' } });
    editor.setSelectionRange(5, 5);
    fireEvent.select(editor);
    const start = view.getByRole('gridcell', { name: 'B2' });
    const end = view.getByRole('gridcell', { name: 'C4' });
    fireEvent(
      start,
      new MouseEvent('pointerdown', {
        button: 0,
        buttons: 1,
        bubbles: true,
        cancelable: true,
      })
    );
    fireEvent(end, new MouseEvent('pointerenter', { buttons: 1 }));
    fireEvent(window, new MouseEvent('pointerup', { button: 0 }));
    const compatibilityMouseDown = new MouseEvent('mousedown', {
      button: 0,
      bubbles: true,
      cancelable: true,
    });
    fireEvent(end, compatibilityMouseDown);
    expect(compatibilityMouseDown.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(editor);
    expect(editor.value).toBe('=SUM(B2:C4,D1)');
    expect(editor.selectionStart).toBe(10);
    expect(view.controller.activeAddress()).toBe('A1');
    expect(view.cells().A1).toBeUndefined();
    expect(
      view.container.querySelectorAll('[data-formula-reference]')
    ).toHaveLength(1);
    fireEvent.keyDown(editor, { key: 'Enter' });
    expect(view.cells().A1.value).toBe('=SUM(B2:C4,D1)');
    expect(view.container.querySelector('[data-formula-reference]')).toBeNull();
  }
);

it('keeps a constant number of selection overlays as ranges grow, with accurate cell semantics', () => {
  const view = renderGrid();
  view.controller.selectRange({ row: 2, column: 1 }, { row: 20, column: 12 });
  expect(
    view.container.querySelectorAll('[data-selection-range]')
  ).toHaveLength(1);
  expect(
    view.container.querySelectorAll('[data-selection-active]')
  ).toHaveLength(1);
  expect(
    view.container.querySelectorAll('[role="gridcell"][aria-selected="true"]')
  ).toHaveLength(19 * 12);
  const first = view.container.querySelector('[data-selection-range]');
  view.controller.selectRange({ row: 0, column: 0 }, { row: 29, column: 25 });
  expect(view.container.querySelector('[data-selection-range]')).toBe(first);
  expect(
    view.container.querySelectorAll('[role="gridcell"][aria-selected="true"]')
  ).toHaveLength(30 * 26);
});

describe('spreadsheet presentation', () => {
  it('renders persistent text, fill, borders and alignment independently of gridlines', () => {
    const view = renderGrid(
      {
        A1: {
          value: 'Styled cell',
          bold: true,
          italic: true,
          underline: true,
          strikethrough: true,
          fontFamily: 'serif',
          fontSize: 18,
          textColor: '#123456',
          fillColor: '#abcdef',
          horizontalAlign: 'center',
          verticalAlign: 'top',
          borderTop: true,
          borderRight: true,
          borderBottom: true,
          borderLeft: true,
          wrap: true,
        },
      },
      { showGridlines: false }
    );
    const cell = view.container.querySelector<HTMLElement>(
      '[data-address="A1"]'
    )!;
    expect(cell.style.fontSize).toBe('24px');
    expect(cell.style.fontFamily).toBe('serif');
    expect(cell.style.fontStyle).toBe('italic');
    expect(cell.style.textDecorationLine).toBe('underline line-through');
    expect(cell.style.color).toBe('rgb(18, 52, 86)');
    expect(cell.style.backgroundColor).toBe('rgb(171, 205, 239)');
    expect(cell.style.textAlign).toBe('center');
    expect(cell.style.justifyContent).toBe('flex-start');
    expect(cell.style.borderColor).toBe('transparent');
    expect(cell.style.boxShadow.match(/inset/g)).toHaveLength(4);
    expect(cell.classList.contains('font-semibold')).toBe(true);
    expect((cell.firstElementChild as HTMLElement).style.whiteSpace).toBe(
      'pre-wrap'
    );
    expect(Number.parseFloat(cell.parentElement!.style.height)).toBeGreaterThan(
      32
    );
  });

  it('uses wrapped row geometry for active and range outlines at different zoom levels', () => {
    const view = renderGrid(
      { A1: { value: 'one\ntwo\nthree', wrap: true } },
      { zoom: 150 }
    );
    const active = view.container.querySelector<HTMLElement>(
      '[data-selection-active]'
    )!;
    expect(active.style.top).toBe('36px');
    expect(active.style.left).toBe('69px');
    expect(active.style.width).toBe('150px');
    expect(active.style.height).toBe('79.5px');
    view.controller.selectRange({ row: 1, column: 1 }, { row: 3, column: 2 });
    const range = view.container.querySelector<HTMLElement>(
      '[data-selection-range]'
    )!;
    expect(range.style.top).toBe('115.5px');
    expect(range.style.left).toBe('219px');
    expect(range.style.width).toBe('300px');
    expect(range.style.height).toBe('94.5px');
  });

  it('accounts for offscreen wrapped rows while keeping only the viewport and selection mounted', () => {
    const view = renderGrid(
      { A100: { value: 'one\ntwo\nthree', wrap: true } },
      { rowCount: 1000 }
    );
    expect(view.container.querySelector('[data-address="A100"]')).toBeNull();
    view.controller.select({ row: 199, column: 0 });
    const active = view.container.querySelector<HTMLElement>(
      '[data-selection-active]'
    )!;
    const cell = view.container.querySelector<HTMLElement>(
      '[data-address="A200"]'
    )!;
    expect(active.style.top).toBe('4235px');
    expect(cell.parentElement!.style.top).toBe(active.style.top);
    expect(view.container.querySelectorAll('[role="row"]').length).toBeLessThan(
      56
    );
    fireEvent.scroll(view.element, { target: { scrollTop: 4100 } });
    expect(view.container.querySelector('[data-address="A200"]')).toBe(cell);
    expect(view.container.querySelectorAll('[role="row"]').length).toBeLessThan(
      64
    );
  });

  it('shows formulas without changing their values or numeric alignment in the normal view', () => {
    const [showFormulas, setShowFormulas] = createSignal(false);
    const view = renderGrid(
      { A1: { value: '=SUM(B1:B3)' } },
      {
        get showFormulas() {
          return showFormulas();
        },
        values: { A1: { display: '6', number: 6 } },
      }
    );
    const cell = view.container.querySelector<HTMLElement>(
      '[data-address="A1"]'
    )!;
    expect(cell.textContent).toBe('6');
    expect(cell.style.textAlign).toBe('right');
    setShowFormulas(true);
    expect(cell.textContent).toBe('=SUM(B1:B3)');
    expect(cell.style.textAlign).toBe('left');
    expect(view.cells().A1.value).toBe('=SUM(B1:B3)');
  });
});
