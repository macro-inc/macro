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
import { SpreadsheetFileMenu } from './SpreadsheetActionMenus';
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
    const file = view.getByRole('button', { name: 'Import and export' });
    fireEvent.keyDown(file, { key: 'ArrowDown' });
    const download = await screen.findByRole('menuitem', {
      name: 'Download as CSV',
    });
    fireEvent.keyDown(download, { key: 'Enter' });
    expect(view.onCommand).toHaveBeenCalledWith('export-csv');
  });

  it.each([
    ['Import…', 'import'],
    ['Download as Excel (.xlsx)', 'export-xlsx'],
  ])('invokes the %s workbook command', async (label, command) => {
    const view = toolbar();
    fireEvent.keyDown(view.getByRole('button', { name: 'Import and export' }), {
      key: 'ArrowDown',
    });
    fireEvent.keyDown(await screen.findByRole('menuitem', { name: label }), {
      key: 'Enter',
    });
    expect(view.onCommand).toHaveBeenCalledWith(command);
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

  it('closes a top menu with Escape and restores editor focus without executing a command', async () => {
    const editor = document.createElement('textarea');
    document.body.append(editor);
    try {
      const view = toolbar({ onRestoreFocus: () => editor.focus() });
      fireEvent.keyDown(
        view.getByRole('button', { name: 'Import and export' }),
        {
          key: 'ArrowDown',
        }
      );
      const importItem = await screen.findByRole('menuitem', {
        name: 'Import…',
      });
      await waitFor(() => expect(document.activeElement).toBe(importItem));
      fireEvent.keyDown(importItem, { key: 'Escape' });
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
      trigger: 'Import and export',
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
      'Functions',
      'Undo',
      'Paste special',
      'Format and data',
    ]) {
      expect(view.getByRole('button', { name }).hasAttribute('disabled')).toBe(
        true
      );
    }
    for (const name of [
      'Zoom',
      'View options',
      'Find and replace',
      'Import and export',
    ]) {
      expect(view.getByRole('button', { name }).hasAttribute('disabled')).toBe(
        false
      );
    }
  });

  it('disables imports for viewers and both download formats when exports are unavailable', async () => {
    const view = toolbar({ readonly: true, canExport: false });
    fireEvent.keyDown(view.getByRole('button', { name: 'Import and export' }), {
      key: 'ArrowDown',
    });
    for (const name of [
      'Import…',
      'Download as Excel (.xlsx)',
      'Download as CSV',
    ]) {
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
