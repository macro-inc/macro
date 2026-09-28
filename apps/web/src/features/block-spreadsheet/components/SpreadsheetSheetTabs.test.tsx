import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@solidjs/testing-library';
import { createSignal, type ParentProps } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  SpreadsheetSheetTabs,
  type SpreadsheetSheetTabsProps,
} from './SpreadsheetSheetTabs';

vi.mock('@ui/components/Tooltip', () => ({
  Tooltip: (props: ParentProps) => props.children,
}));
vi.mock('@core/mobile/mobileWidth', () => ({ isMobileWidth: () => true }));

let animationStyle: HTMLStyleElement;
beforeEach(() => {
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
    configurable: true,
    value: vi.fn(),
  });
  animationStyle = document.createElement('style');
  animationStyle.textContent = '* { animation-name: none !important; }';
  document.head.append(animationStyle);
});
afterEach(() => {
  cleanup();
  animationStyle.remove();
  vi.restoreAllMocks();
});

function tabs(overrides: Partial<SpreadsheetSheetTabsProps> = {}) {
  const [active, setActive] = createSignal('budget');
  const onSelect = vi.fn((id: string) => setActive(id));
  const onAdd = vi.fn();
  const onRename = vi.fn();
  const onDuplicate = vi.fn();
  const onDelete = vi.fn();
  const view = render(() => (
    <SpreadsheetSheetTabs
      sheets={[
        { id: 'budget', name: 'Budget' },
        { id: 'sales', name: 'Sales' },
        { id: 'forecast', name: 'Forecast' },
      ]}
      activeSheetId={active()}
      readonly={false}
      canAdd={true}
      onSelect={onSelect}
      onAdd={onAdd}
      onRename={onRename}
      onDuplicate={onDuplicate}
      onDelete={onDelete}
      {...overrides}
    />
  ));
  return { ...view, active, onSelect, onAdd, onRename, onDuplicate, onDelete };
}

describe('spreadsheet sheet tabs', () => {
  it('selects sheets with click and roving arrow, Home, and End navigation', () => {
    const view = tabs();
    const budget = view.getByRole('tab', { name: 'Budget' });
    const sales = view.getByRole('tab', { name: 'Sales' });
    const forecast = view.getByRole('tab', { name: 'Forecast' });
    expect(budget.getAttribute('aria-selected')).toBe('true');
    expect(budget.tabIndex).toBe(0);
    expect(sales.tabIndex).toBe(-1);
    fireEvent.keyDown(budget, { key: 'ArrowRight' });
    expect(view.active()).toBe('sales');
    expect(document.activeElement).toBe(sales);
    expect(sales.tabIndex).toBe(0);
    fireEvent.keyDown(sales, { key: 'End' });
    expect(document.activeElement).toBe(forecast);
    fireEvent.keyDown(forecast, { key: 'ArrowRight' });
    expect(document.activeElement).toBe(budget);
    fireEvent.keyDown(budget, { key: 'ArrowLeft' });
    expect(document.activeElement).toBe(forecast);
    fireEvent.keyDown(forecast, { key: 'Home' });
    expect(document.activeElement).toBe(budget);
    fireEvent.click(sales);
    expect(view.active()).toBe('sales');
  });

  it('opens rename for the double-clicked tab and prevents viewer renames', () => {
    const [readonly, setReadonly] = createSignal(false);
    const view = tabs({
      get readonly() {
        return readonly();
      },
    });
    fireEvent.dblClick(view.getByRole('tab', { name: 'Sales' }));
    expect(view.onRename).toHaveBeenCalledWith('sales');
    setReadonly(true);
    fireEvent.dblClick(view.getByRole('tab', { name: 'Budget' }));
    expect(view.onRename).toHaveBeenCalledTimes(1);
  });

  it.each(['Rename', 'Duplicate', 'Delete'] as const)(
    'targets the right-clicked inactive sheet for %s after closing its menu',
    async (label) => {
      const action = vi.fn();
      const view = tabs({
        onRename: action,
        onDuplicate: action,
        onDelete: action,
      });
      const target = view.getByRole('tab', { name: 'Sales' });
      expect(
        fireEvent.contextMenu(target, { clientX: 120, clientY: 200 })
      ).toBe(false);
      const item = await screen.findByRole('menuitem', { name: label });
      expect(view.active()).toBe('sales');
      fireEvent.keyDown(item, { key: 'Enter' });
      await waitFor(() => expect(action).toHaveBeenCalledWith('sales'));
    }
  );

  it('keeps context actions disabled for viewers', async () => {
    const view = tabs({ readonly: true });
    fireEvent.contextMenu(view.getByRole('tab', { name: 'Sales' }));
    for (const name of ['Rename', 'Duplicate', 'Delete']) {
      const item = await screen.findByRole('menuitem', { name });
      expect(item.getAttribute('aria-disabled')).toBe('true');
    }
    expect(view.onRename).not.toHaveBeenCalled();
    expect(view.onDuplicate).not.toHaveBeenCalled();
    expect(view.onDelete).not.toHaveBeenCalled();
  });

  it('adds sheets and leaves selection enabled for viewers', () => {
    const view = tabs({ readonly: true });
    expect(
      view.getByRole('button', { name: 'Add sheet' }).hasAttribute('disabled')
    ).toBe(true);
    expect(
      view
        .getByRole('button', { name: 'Sheet actions for Budget' })
        .hasAttribute('disabled')
    ).toBe(true);
    fireEvent.click(view.getByRole('tab', { name: 'Sales' }));
    expect(view.onSelect).toHaveBeenCalledWith('sales');
    expect(view.onAdd).not.toHaveBeenCalled();
  });

  it('invokes the add callback for an editable workbook', () => {
    const view = tabs();
    fireEvent.click(view.getByRole('button', { name: 'Add sheet' }));
    expect(view.onAdd).toHaveBeenCalledOnce();
  });

  it('makes adding rows available through the sheet menu after it closes', async () => {
    const onAddRows = vi.fn();
    const view = tabs({ onAddRows, addRowsLabel: 'Add 100 rows' });
    fireEvent.keyDown(
      view.getByRole('button', { name: 'Sheet actions for Budget' }),
      { key: 'ArrowDown' }
    );
    const item = await screen.findByRole('menuitem', { name: 'Add 100 rows' });
    fireEvent.keyDown(item, { key: 'Enter' });
    expect(onAddRows).not.toHaveBeenCalled();
    await waitFor(() => expect(onAddRows).toHaveBeenCalledOnce());
  });

  it('does not add rows if editing permission changes while the menu is open', async () => {
    const [readonly, setReadonly] = createSignal(false);
    const onAddRows = vi.fn();
    const view = tabs({
      onAddRows,
      get readonly() {
        return readonly();
      },
    });
    fireEvent.keyDown(
      view.getByRole('button', { name: 'Sheet actions for Budget' }),
      { key: 'ArrowDown' }
    );
    const item = await screen.findByRole('menuitem', { name: 'Add rows' });
    setReadonly(true);
    expect(item.getAttribute('aria-disabled')).toBe('true');
    fireEvent.keyDown(item, { key: 'Enter' });
    expect(onAddRows).not.toHaveBeenCalled();
  });

  it.each(['Rename', 'Duplicate', 'Delete'] as const)(
    'defers %s until its menu closes so dialogs retain focus',
    async (label) => {
      const dialogInput = document.createElement('input');
      document.body.append(dialogInput);
      const action = vi.fn(() => dialogInput.focus());
      try {
        const view = tabs({
          onRename: action,
          onDuplicate: action,
          onDelete: action,
        });
        fireEvent.keyDown(
          view.getByRole('button', { name: 'Sheet actions for Budget' }),
          { key: 'ArrowDown' }
        );
        const item = await screen.findByRole('menuitem', { name: label });
        item.focus();
        fireEvent.keyDown(item, { key: 'Enter' });
        expect(action).not.toHaveBeenCalled();
        await waitFor(() => expect(action).toHaveBeenCalledWith('budget'));
        expect(document.activeElement).toBe(dialogInput);
      } finally {
        dialogInput.remove();
      }
    }
  );

  it('prevents deleting the last sheet and duplicating beyond the sheet limit', async () => {
    const view = tabs({
      sheets: [{ id: 'budget', name: 'Budget' }],
      canAdd: false,
    });
    expect(
      view.getByRole('button', { name: 'Add sheet' }).hasAttribute('disabled')
    ).toBe(true);
    fireEvent.keyDown(
      view.getByRole('button', { name: 'Sheet actions for Budget' }),
      { key: 'ArrowDown' }
    );
    for (const name of ['Duplicate', 'Delete']) {
      const item = await screen.findByRole('menuitem', { name });
      expect(item.getAttribute('aria-disabled')).toBe('true');
      fireEvent.keyDown(item, { key: 'Enter' });
    }
    expect(view.onDuplicate).not.toHaveBeenCalled();
    expect(view.onDelete).not.toHaveBeenCalled();
  });
});
