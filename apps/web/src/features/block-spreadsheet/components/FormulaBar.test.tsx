import { cleanup, fireEvent, render } from '@solidjs/testing-library';
import type { ParentProps } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FormulaBar } from './SpreadsheetToolbar';

vi.mock('@ui/components/Tooltip', () => ({
  Tooltip: (props: ParentProps) => props.children,
}));

afterEach(cleanup);

function formulaBar(options: { editing?: boolean; readonly?: boolean } = {}) {
  const onCommit = vi.fn();
  const onCancel = vi.fn();
  const onReturnToGrid = vi.fn();
  const view = render(() => (
    <FormulaBar
      address="B4"
      value="=SUM(B2:B3)"
      readonly={options.readonly ?? false}
      editing={options.editing ?? true}
      complete={async () => undefined}
      onNavigate={() => {}}
      onEdit={() => {}}
      onInput={() => {}}
      onCommit={onCommit}
      onCancel={onCancel}
      onReturnToGrid={onReturnToGrid}
    />
  ));
  return { ...view, onCommit, onCancel, onReturnToGrid };
}

describe('mobile formula bar edit controls', () => {
  it.each(['Apply edit', 'Cancel edit'] as const)(
    '%s keeps the editor focused through touch and compatibility mouse events',
    (label) => {
      const view = formulaBar();
      const input = view.getByRole('textbox', {
        name: 'Formula bar',
      }) as HTMLTextAreaElement;
      const button = view.getByRole('button', { name: label });
      const onBlur = vi.fn();
      input.addEventListener('blur', onBlur);
      input.focus();
      input.setSelectionRange(5, 10);

      expect(fireEvent.pointerDown(button, { pointerType: 'touch' })).toBe(
        false
      );
      expect(document.activeElement).toBe(input);
      expect(view.onCommit).not.toHaveBeenCalled();
      expect(view.onCancel).not.toHaveBeenCalled();

      // Physical iPhones can emit this even after cancelled pointerdown.
      // jsdom lacks mousedown's focus default, so model it when not cancelled.
      const mouseDown = new MouseEvent('mousedown', {
        bubbles: true,
        cancelable: true,
        button: 0,
      });
      if (fireEvent(button, mouseDown)) button.focus();
      expect(mouseDown.defaultPrevented).toBe(true);
      expect(document.activeElement).toBe(input);
      expect([input.selectionStart, input.selectionEnd]).toEqual([5, 10]);
      expect(onBlur).not.toHaveBeenCalled();
      expect(view.onCommit).not.toHaveBeenCalled();
      expect(view.onCancel).not.toHaveBeenCalled();
      expect(view.onReturnToGrid).not.toHaveBeenCalled();

      fireEvent.click(button);
      if (label === 'Apply edit') {
        expect(view.onCommit).toHaveBeenCalledOnce();
        expect(view.onCancel).not.toHaveBeenCalled();
      } else {
        expect(view.onCancel).toHaveBeenCalledOnce();
        expect(view.onCommit).not.toHaveBeenCalled();
      }
      expect(view.onReturnToGrid).toHaveBeenCalledOnce();
    }
  );

  it.each([{ editing: false }, { readonly: true }])(
    'hides edit controls when editing is unavailable: %j',
    (options) => {
      const view = formulaBar(options);
      expect(view.queryByRole('button', { name: 'Apply edit' })).toBeNull();
      expect(view.queryByRole('button', { name: 'Cancel edit' })).toBeNull();
    }
  );
});
