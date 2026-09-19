import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@solidjs/testing-library';
import { type ComponentProps, createSignal, type ParentProps } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SpreadsheetFindDialog } from './SpreadsheetDialogs';
import {
  SpreadsheetImportDialog,
  SpreadsheetSheetDialog,
} from './SpreadsheetWorkbookDialogs';

vi.mock('@ui/components/Tooltip', () => ({
  Tooltip: (props: ParentProps) => props.children,
}));
vi.mock('@core/mobile/isMobile', () => ({ isMobile: () => false }));
vi.mock('@components/app/mobile/MobileDrawer', () => ({
  MobileDrawer: () => null,
}));

let animationStyle: HTMLStyleElement;
beforeEach(() => {
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
  animationStyle = document.createElement('style');
  animationStyle.textContent = '* { animation-name: none !important; }';
  document.head.append(animationStyle);
});
afterEach(() => {
  cleanup();
  animationStyle.remove();
  vi.restoreAllMocks();
});

function sheetDialog(
  overrides: Partial<ComponentProps<typeof SpreadsheetSheetDialog>> = {}
) {
  const [dialog, setDialog] = createSignal<
    { kind: 'rename' | 'delete'; name: string } | undefined
  >();
  const [name, setName] = createSignal('Budget');
  const onConfirm = vi.fn();
  const view = render(() => (
    <>
      <button
        type="button"
        onClick={() => setDialog({ kind: 'rename', name: 'Budget' })}
      >
        Rename
      </button>
      <SpreadsheetSheetDialog
        dialog={dialog()}
        name={name()}
        onName={setName}
        error=""
        readonly={false}
        onConfirm={onConfirm}
        onClose={() => setDialog(undefined)}
        {...overrides}
      />
    </>
  ));
  return { ...view, onConfirm, setName };
}

const preview = {
  name: 'Budget.xlsx',
  data: {
    sheets: [{ name: 'Budget', cells: {}, rowCount: 200, columnWidths: {} }],
    warnings: [],
  },
};

describe('workbook dialogs', () => {
  it('returns focus to the editor when Find closes and leaves IME Enter alone', async () => {
    const [open, setOpen] = createSignal(false);
    const find = vi.fn();
    const view = render(() => (
      <>
        <div role="grid" aria-label="Spreadsheet" tabIndex={0} />
        <SpreadsheetFindDialog
          open={open()}
          onClose={() => setOpen(false)}
          query="Budget"
          onQuery={() => {}}
          replacement=""
          onReplacement={() => {}}
          options={{ matchCase: false, entireCell: false, formulas: false }}
          onOptions={() => {}}
          matchCount={1}
          matchIndex={0}
          readonly={false}
          notice=""
          onFind={find}
          onReplace={() => {}}
        />
      </>
    ));
    const grid = view.getByRole('grid');
    grid.focus();
    setOpen(true);
    const input = await screen.findByRole('textbox', { name: 'Find in sheet' });
    await waitFor(() => expect(document.activeElement).toBe(input));
    fireEvent.keyDown(input, { key: 'Enter', isComposing: true });
    expect(find).not.toHaveBeenCalled();
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(find).toHaveBeenCalledWith(false);
    fireEvent.keyDown(input, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(grid));
  });

  it('focuses and selects the sheet name on opening and reopening, and Escape closes', async () => {
    const view = sheetDialog();
    const trigger = view.getByRole('button', { name: 'Rename' });
    for (let index = 0; index < 2; index++) {
      trigger.focus();
      fireEvent.click(trigger);
      const input = (await screen.findByRole('textbox', {
        name: 'Sheet name',
      })) as HTMLInputElement;
      await waitFor(() => expect(document.activeElement).toBe(input));
      expect(input.selectionStart).toBe(0);
      expect(input.selectionEnd).toBe('Budget'.length);
      fireEvent.keyDown(input, { key: 'Escape' });
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
      await waitFor(() => expect(document.activeElement).toBe(trigger));
    }
    expect(view.onConfirm).not.toHaveBeenCalled();
  });

  it('associates duplicate-name errors with the rename input', () => {
    sheetDialog({
      dialog: { kind: 'rename', name: 'Budget' },
      error: 'A sheet named Budget already exists.',
    });
    const input = screen.getByRole('textbox', { name: 'Sheet name' });
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(input.getAttribute('aria-describedby')).toBe(
      screen.getByRole('alert').id
    );
  });

  it('blocks empty or read-only rename submission while allowing confirmed deletion', () => {
    const [readonly, setReadonly] = createSignal(false);
    const [kind, setKind] = createSignal<'rename' | 'delete'>('rename');
    const onConfirm = vi.fn();
    render(() => (
      <SpreadsheetSheetDialog
        dialog={{ kind: kind(), name: 'Budget' }}
        name=""
        onName={() => {}}
        error=""
        readonly={readonly()}
        onConfirm={onConfirm}
        onClose={() => {}}
      />
    ));
    const form = screen.getByRole('dialog').querySelector('form')!;
    fireEvent.submit(form);
    expect(onConfirm).not.toHaveBeenCalled();
    setKind('delete');
    fireEvent.submit(form);
    expect(onConfirm).toHaveBeenCalledTimes(1);
    setReadonly(true);
    fireEvent.submit(form);
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(
      screen
        .getByRole('button', { name: 'Delete sheet' })
        .hasAttribute('disabled')
    ).toBe(true);
  });

  it('keeps import radio groups independent across mounted workbook dialogs', () => {
    render(() => (
      <>
        <SpreadsheetImportDialog
          preview={preview}
          mode="append"
          onMode={() => {}}
          error=""
          readonly={false}
          onConfirm={() => {}}
          onClose={() => {}}
        />
        <SpreadsheetImportDialog
          preview={preview}
          mode="replace"
          onMode={() => {}}
          error=""
          readonly={false}
          onConfirm={() => {}}
          onClose={() => {}}
        />
      </>
    ));
    const radios = [
      ...document.querySelectorAll<HTMLInputElement>('input[type="radio"]'),
    ];
    expect(radios).toHaveLength(4);
    expect(radios[0].name).toBe(radios[1].name);
    expect(radios[2].name).toBe(radios[3].name);
    expect(radios[0].name).not.toBe(radios[2].name);
    expect(radios[0].checked).toBe(true);
    expect(radios[3].checked).toBe(true);
  });

  it('links import errors and disables all mutation controls when read-only', () => {
    const confirm = vi.fn();
    render(() => (
      <SpreadsheetImportDialog
        preview={preview}
        mode="append"
        onMode={() => {}}
        error="The workbook changed. Review the import again."
        readonly
        onConfirm={confirm}
        onClose={() => {}}
      />
    ));
    const group = screen.getByRole('group', { name: 'Import location' });
    expect(group.hasAttribute('disabled')).toBe(true);
    expect(group.getAttribute('aria-describedby')).toBe(
      screen.getByRole('alert').id
    );
    const button = screen.getByRole('button', { name: 'Import workbook' });
    expect(button.hasAttribute('disabled')).toBe(true);
    fireEvent.click(button);
    expect(confirm).not.toHaveBeenCalled();
  });
});
