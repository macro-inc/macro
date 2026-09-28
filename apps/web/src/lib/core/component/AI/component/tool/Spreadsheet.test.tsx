import type { SpreadsheetResponse } from '@macro-inc/spreadsheet/ai-types';
import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import type { Component, JSX, ParentProps } from 'solid-js';
import { Dynamic } from 'solid-js/web';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  calculateSpreadsheetHandler,
  editSpreadsheetHandler,
  readSpreadsheetHandler,
} from './Spreadsheet';
import { ToolErrorContext } from './ToolRenderer';

// Isolate the app's global hotkey/tooltip registry while keeping the real tool layout.
vi.mock('@ui', () => ({
  Layer: (props: ParentProps) => props.children,
  Button: (props: JSX.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button
      type="button"
      onClick={props.onClick}
      aria-expanded={props['aria-expanded']}
    >
      {props.children}
    </button>
  ),
}));

afterEach(cleanup);

function renderTool(
  handler:
    | typeof readSpreadsheetHandler
    | typeof calculateSpreadsheetHandler
    | typeof editSpreadsheetHandler,
  result?: SpreadsheetResponse,
  error?: string
) {
  return render(() => (
    <ToolErrorContext.Provider value={() => error}>
      <Dynamic
        component={handler.render as Component<Record<string, unknown>>}
        response={result ? { data: result } : undefined}
        renderContext={{ isStreaming: !result, grouped: false }}
      />
    </ToolErrorContext.Provider>
  ));
}

const sheet = {
  id: 'sheet1',
  name: 'Budget',
  rowCount: 200,
  columnCount: 26,
  usedRange: 'A1:B9',
  populatedCells: 10,
  formulaCells: 2,
  errorCells: 0,
};

describe('spreadsheet tool results', () => {
  it('renders a pending call without a misleading empty result toggle', () => {
    renderTool(readSpreadsheetHandler);
    expect(screen.getByText('Read spreadsheet')).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.queryByRole('table')).toBeNull();
  });

  it('expands source cells, calculated values, truncation and compatibility warnings', () => {
    renderTool(readSpreadsheetHandler, {
      action: 'read',
      revision: 'revision',
      sheets: [sheet],
      ranges: [
        {
          sheetId: 'sheet1',
          sheetName: 'Budget',
          range: 'B4:B9',
          truncated: true,
          cells: [
            {
              address: 'B9',
              source: '=SUM(B4:B7)',
              formula: '=SUM(B4:B7)',
              type: 'number',
              value: 22500,
              display: '$22,500.00',
            },
          ],
        },
      ],
      warnings: ['One formula uses an unsupported function.'],
    });
    const toggle = screen.getByRole('button', { name: '1 sheet' });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByRole('table')).toBeNull();
    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByRole('table').textContent).toContain('=SUM(B4:B7)');
    expect(screen.getByRole('table').textContent).toContain('$22,500.00');
    expect(screen.getByText('Showing part of this range.')).toBeTruthy();
    expect(
      screen.getByText('One formula uses an unsupported function.')
    ).toBeTruthy();
    fireEvent.click(toggle);
    expect(screen.queryByRole('table')).toBeNull();
  });

  it('labels scratch calculations as unchanged and shows zero values and formula errors', () => {
    renderTool(calculateSpreadsheetHandler, {
      action: 'calculate',
      revision: 'revision',
      warnings: [],
      results: [
        {
          label: 'Remaining',
          formula: '=B4-C4',
          type: 'number',
          value: 0,
          display: '0',
        },
        {
          formula: '=1/0',
          type: 'error',
          value: '#DIV/0!',
          display: '#DIV/0!',
          error: 'Division by zero',
        },
      ],
    });
    fireEvent.click(screen.getByRole('button', { name: '2 results' }));
    expect(
      screen.getByText('Scratch calculation · workbook unchanged')
    ).toBeTruthy();
    expect(screen.getByText('Remaining')).toBeTruthy();
    expect(screen.getByText('0')).toBeTruthy();
    expect(screen.getByText('Division by zero')).toBeTruthy();
    expect(screen.queryByText('(empty)')).toBeNull();
  });

  it.each([true, false])(
    'reports acknowledged edit state when applied=%s',
    (applied) => {
      renderTool(editSpreadsheetHandler, {
        action: 'edit',
        revision: 'revision',
        applied,
        warnings: [],
        sheets: [sheet],
        changes: applied
          ? [
              {
                type: 'set_cells',
                sheetId: 'sheet1',
                summary: 'Updated 2 cells',
                range: 'B4:C4',
              },
            ]
          : [],
      });
      fireEvent.click(
        screen.getByRole('button', { name: applied ? '1 change' : '0 changes' })
      );
      expect(
        screen.getByText(applied ? 'Changes saved' : 'No new changes')
      ).toBeTruthy();
      if (applied)
        expect(screen.getByText(/Updated 2 cells/).textContent).toContain(
          'B4:C4'
        );
    }
  );

  it('shows the shared failed state when the tool request was rejected', () => {
    renderTool(editSpreadsheetHandler, undefined, 'Permission denied');
    expect(screen.getByText('Failed')).toBeTruthy();
    expect(screen.queryByText('Changes saved')).toBeNull();
  });
});
