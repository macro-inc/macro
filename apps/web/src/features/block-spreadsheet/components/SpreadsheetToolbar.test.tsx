import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@solidjs/testing-library';
import { createSignal, type ParentProps } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SpreadsheetToolbarProps } from '../core/toolbar-types';
import {
  SpreadsheetFileMenu,
  SpreadsheetImportButton,
} from './SpreadsheetActionMenus';
import { SpreadsheetToolbar } from './SpreadsheetToolbar';

// App hotkey registries are outside this presentational menu fixture.
vi.mock('@ui/components/Tooltip', () => ({
  Tooltip: (props: ParentProps) => props.children,
}));

let animationStyle: HTMLStyleElement;
beforeEach(() => {
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
  // jsdom reports an empty animation name instead of "none", which keeps
  // Solid Presence waiting forever for an animationend that cannot arrive.
  animationStyle = document.createElement('style');
  animationStyle.textContent = '* { animation-name: none !important; }';
  document.head.append(animationStyle);
});
afterEach(() => {
  cleanup();
  animationStyle.remove();
  vi.restoreAllMocks();
});

function toolbar(
  overrides: Partial<SpreadsheetToolbarProps> & { canExport?: boolean } = {}
) {
  const onCommand = vi.fn();
  const onStyle = vi.fn();
  const onZoom = vi.fn();
  const view = render(() => (
    <>
      <SpreadsheetToolbar
        readonly={false}
        canUndo={true}
        canRedo={false}
        cell={{ value: 'Sample', bold: true, format: 'number' }}
        zoom={100}
        showGridlines={true}
        showFormulaBar={true}
        showFormulas={false}
        onCommand={onCommand}
        onStyle={onStyle}
        onZoom={onZoom}
        {...overrides}
      />
      <SpreadsheetImportButton
        disabled={overrides.readonly ?? false}
        onCommand={onCommand}
      />
      <SpreadsheetFileMenu
        readonly={overrides.readonly ?? false}
        canExport={overrides.canExport ?? true}
        onCommand={onCommand}
        onRestoreFocus={overrides.onRestoreFocus}
      />
    </>
  ));
  return { ...view, onCommand, onStyle, onZoom };
}

describe('spreadsheet toolbar', () => {
  it('applies formatting to the existing selection through callbacks', () => {
    const view = toolbar();
    expect(
      view.getByRole('button', { name: 'Bold' }).getAttribute('aria-pressed')
    ).toBe('true');
    fireEvent.click(view.getByRole('button', { name: 'Bold' }));
    fireEvent.click(view.getByRole('button', { name: 'Italic' }));
    fireEvent.click(view.getByRole('button', { name: 'Format as percent' }));
    expect(view.onStyle.mock.calls).toEqual([
      [{ bold: false }],
      [{ italic: true }],
      [{ format: 'percent' }],
    ]);
    fireEvent.click(view.getByRole('button', { name: 'Undo' }));
    expect(view.onCommand).toHaveBeenCalledWith('undo');
  });

  it('indents the selection and returns focus to the sheet', () => {
    const onRestoreFocus = vi.fn();
    const view = toolbar({ onRestoreFocus });
    fireEvent.click(view.getByRole('button', { name: 'Increase indent' }));
    fireEvent.click(view.getByRole('button', { name: 'Decrease indent' }));
    expect(view.onCommand.mock.calls).toEqual([
      ['indent-increase'],
      ['indent-decrease'],
    ]);
    expect(onRestoreFocus).toHaveBeenCalledTimes(2);
  });

  it('cancels a font size draft and restores keyboard focus without applying it', () => {
    const editor = document.createElement('textarea');
    document.body.append(editor);
    try {
      const view = toolbar({ onRestoreFocus: () => editor.focus() });
      const size = view.getByRole('spinbutton', {
        name: 'Font size',
      }) as HTMLInputElement;
      size.focus();
      fireEvent.input(size, { target: { value: '24' } });
      fireEvent.keyDown(size, { key: 'Escape' });
      expect(size.value).toBe('10');
      expect(document.activeElement).toBe(editor);
      expect(view.onStyle).not.toHaveBeenCalled();
    } finally {
      editor.remove();
    }
  });

  it('keeps commands in the ribbon without a second menu row', () => {
    const view = toolbar();
    expect(view.queryByRole('menubar')).toBeNull();
    for (const name of [
      'File',
      'Edit',
      'View',
      'Insert',
      'Format',
      'Data',
      'Help',
    ]) {
      expect(view.queryByRole('button', { name })).toBeNull();
    }
    fireEvent.click(view.getByRole('button', { name: 'Find and replace' }));
    expect(view.onCommand).toHaveBeenCalledWith('find');
  });

  it.each([
    ['Paste special', 'Paste values only', 'paste-values'],
    ['Format and data', 'Sort selected range A → Z', 'sort-asc'],
    ['Format and data', 'Fill down', 'fill-down'],
    ['Format and data', 'Clear formatting', 'clear-formatting'],
    ['Format and data', 'Goal Seek…', 'goal-seek'],
  ])(
    'keeps %s / %s reachable with the keyboard',
    async (trigger, item, command) => {
      const view = toolbar();
      fireEvent.keyDown(view.getByRole('button', { name: trigger }), {
        key: 'ArrowDown',
      });
      fireEvent.keyDown(await screen.findByRole('menuitem', { name: item }), {
        key: 'Enter',
      });
      expect(view.onCommand).toHaveBeenCalledWith(command);
    }
  );

  it('opens menus with the keyboard and invokes the selected command', async () => {
    const view = toolbar();
    const file = view.getByRole('button', { name: 'Download' });
    fireEvent.keyDown(file, { key: 'ArrowDown' });
    const download = await screen.findByRole('menuitem', {
      name: 'Download as CSV',
    });
    fireEvent.keyDown(download, { key: 'Enter' });
    expect(view.onCommand).toHaveBeenCalledWith('export-csv');
  });

  it('invokes the import command from the standalone button', () => {
    const view = toolbar();
    fireEvent.click(view.getByRole('button', { name: 'Import' }));
    expect(view.onCommand).toHaveBeenCalledWith('import');
  });

  it('invokes the Download as Excel (.xlsx) workbook command', async () => {
    const view = toolbar();
    fireEvent.keyDown(view.getByRole('button', { name: 'Download' }), {
      key: 'ArrowDown',
    });
    fireEvent.keyDown(
      await screen.findByRole('menuitem', {
        name: 'Download as Excel (.xlsx)',
      }),
      { key: 'Enter' }
    );
    expect(view.onCommand).toHaveBeenCalledWith('export-xlsx');
  });

  it('exposes checked view settings directly with the keyboard', async () => {
    const view = toolbar();
    fireEvent.keyDown(view.getByRole('button', { name: 'View options' }), {
      key: 'ArrowDown',
    });
    const gridlines = await screen.findByRole('menuitemcheckbox', {
      name: 'Gridlines',
    });
    expect(gridlines.getAttribute('aria-checked')).toBe('true');
    fireEvent.keyDown(gridlines, { key: 'Enter' });
    expect(view.onCommand).toHaveBeenCalledWith('toggle-gridlines');
  });

  it('keeps view-only display settings available but not the saved gridlines', async () => {
    const view = toolbar({ readonly: true });
    fireEvent.keyDown(view.getByRole('button', { name: 'View options' }), {
      key: 'ArrowDown',
    });
    const gridlines = await screen.findByRole('menuitemcheckbox', {
      name: 'Gridlines',
    });
    expect(gridlines.getAttribute('aria-disabled')).toBe('true');
    fireEvent.keyDown(gridlines, { key: 'Enter' });
    fireEvent.keyDown(
      screen.getByRole('menuitemcheckbox', { name: 'Formula bar' }),
      { key: 'Enter' }
    );
    expect(view.onCommand.mock.calls).toEqual([['toggle-formula-bar']]);
  });

  it('closes a top menu with Escape and restores editor focus without executing a command', async () => {
    const editor = document.createElement('textarea');
    document.body.append(editor);
    try {
      const view = toolbar({ onRestoreFocus: () => editor.focus() });
      fireEvent.keyDown(view.getByRole('button', { name: 'Download' }), {
        key: 'ArrowDown',
      });
      const excelItem = await screen.findByRole('menuitem', {
        name: 'Download as Excel (.xlsx)',
      });
      await waitFor(() => expect(document.activeElement).toBe(excelItem));
      fireEvent.keyDown(excelItem, { key: 'Escape' });
      await waitFor(() => expect(document.activeElement).toBe(editor));
      expect(view.onCommand).not.toHaveBeenCalled();
    } finally {
      editor.remove();
    }
  });

  it('shows checked formatting and applies number formats from the dropdown', async () => {
    const view = toolbar();
    fireEvent.keyDown(view.getByRole('button', { name: 'Number format' }), {
      key: 'ArrowDown',
    });
    fireEvent.keyDown(
      await screen.findByRole('menuitem', { name: 'Currency $1,234.00' }),
      { key: 'Enter' }
    );
    expect(view.onStyle).toHaveBeenCalledWith({ format: 'currency' });
    fireEvent.keyDown(view.getByRole('button', { name: 'Number format' }), {
      key: 'ArrowDown',
    });
    fireEvent.keyDown(
      await screen.findByRole('menuitem', {
        name: 'Accounting $ (1,234.00)',
      }),
      { key: 'Enter' }
    );
    expect(view.onStyle).toHaveBeenCalledWith({ format: 'accounting' });
  });

  it.each([
    ['Sep 2026', { style: { format: 'date', numberFormat: 'mmm yyyy' } }],
    [
      'Thursday, September 17, 2026',
      { style: { format: 'date', numberFormat: 'dddd, mmmm d, yyyy' } },
    ],
    ['Custom date and time…', { command: 'custom-date-format' }],
  ])('offers %s under Number format → Date formats', async (item, expected) => {
    const view = toolbar();
    fireEvent.keyDown(view.getByRole('button', { name: 'Number format' }), {
      key: 'ArrowDown',
    });
    fireEvent.keyDown(
      await screen.findByRole('menuitem', { name: 'Date formats' }),
      { key: 'ArrowRight' }
    );
    fireEvent.keyDown(await screen.findByRole('menuitem', { name: item }), {
      key: 'Enter',
    });
    if ('style' in expected)
      expect(view.onStyle).toHaveBeenCalledWith(expected.style);
    else expect(view.onCommand).toHaveBeenCalledWith(expected.command);
  });

  it.each([
    {
      role: 'button',
      trigger: 'Functions',
      item: 'SUM Add values',
      command: 'insert-sum',
    },
    {
      role: 'button',
      trigger: 'Download',
      item: 'Download as CSV',
      command: 'export-csv',
    },
  ])(
    'restores editing focus after choosing $trigger menu actions',
    async ({ role, trigger, item, command }) => {
      const editor = document.createElement('textarea');
      document.body.append(editor);
      const onRestoreFocus = vi.fn(() => editor.focus());
      try {
        const view = toolbar({ onRestoreFocus });
        fireEvent.keyDown(view.getByRole(role, { name: trigger }), {
          key: 'ArrowDown',
        });
        const action = await screen.findByRole('menuitem', { name: item });
        await waitFor(() =>
          expect(document.activeElement?.getAttribute('role')).toBe('menuitem')
        );
        action.focus();
        fireEvent.keyDown(action, { key: 'Enter' });
        expect(view.onCommand).toHaveBeenCalledWith(command);
        await waitFor(() => expect(onRestoreFocus).toHaveBeenCalled());
        expect(document.activeElement).toBe(editor);
      } finally {
        editor.remove();
      }
    }
  );

  it('keeps editing commands unavailable for viewers while leaving navigation accessible', () => {
    const view = toolbar({ readonly: true, canUndo: false });
    for (const name of [
      'Bold',
      'Italic',
      'Fill color',
      'Number format',
      'Increase indent',
      'Decrease indent',
      'Functions',
      'Undo',
      'Paste special',
      'Format and data',
      'Import',
    ]) {
      expect(view.getByRole('button', { name }).hasAttribute('disabled')).toBe(
        true
      );
    }
    for (const name of [
      'Zoom',
      'View options',
      'Find and replace',
      'Download',
    ]) {
      expect(view.getByRole('button', { name }).hasAttribute('disabled')).toBe(
        false
      );
    }
  });

  it('disables imports for viewers and both download formats when exports are unavailable', async () => {
    const view = toolbar({ readonly: true, canExport: false });
    expect(
      view.getByRole('button', { name: 'Import' }).hasAttribute('disabled')
    ).toBe(true);
    fireEvent.keyDown(view.getByRole('button', { name: 'Download' }), {
      key: 'ArrowDown',
    });
    for (const name of ['Download as Excel (.xlsx)', 'Download as CSV']) {
      const item = await screen.findByRole('menuitem', { name });
      expect(item.getAttribute('aria-disabled')).toBe('true');
      fireEvent.keyDown(item, { key: 'Enter' });
    }
    expect(view.onCommand).not.toHaveBeenCalled();
  });

  it.each([
    ['Functions', 'SUM Add values'],
    ['Format and data', 'Fill down'],
    ['Paste special', 'Paste values only'],
  ])(
    'disables %s choices when permission changes while their menu is open',
    async (trigger, item) => {
      const [readonly, setReadonly] = createSignal(false);
      const view = toolbar({
        get readonly() {
          return readonly();
        },
      });
      fireEvent.keyDown(view.getByRole('button', { name: trigger }), {
        key: 'ArrowDown',
      });
      const sum = await screen.findByRole('menuitem', { name: item });
      setReadonly(true);
      expect(sum.getAttribute('aria-disabled')).toBe('true');
      fireEvent.keyDown(sum, { key: 'Enter' });
      expect(view.onCommand).not.toHaveBeenCalled();
    }
  );
});
