import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import type { ParentProps } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DateFormatDialog } from './DateFormatDialog';

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

describe('custom date and time format dialog', () => {
  it('previews the active cell in the typed code and applies its style', () => {
    const onSave = vi.fn();
    render(() => (
      <DateFormatDialog
        dialog={{ range: 'B2:B9', numberFormat: 'm/d/yyyy', sample: 46023 }}
        onSave={onSave}
        onClose={() => {}}
        onRestoreFocus={() => {}}
      />
    ));
    const code = screen.getByRole('textbox', { name: 'Format code' });
    expect(screen.getByRole('status').textContent).toBe('Preview: 1/1/2026');
    fireEvent.input(code, { target: { value: 'ddd, d mmm yyyy' } });
    expect(screen.getByRole('status').textContent).toBe(
      'Preview: Thu, 1 Jan 2026'
    );
    fireEvent.submit(screen.getByRole('dialog').querySelector('form')!);
    expect(onSave).toHaveBeenCalledWith({
      format: 'date',
      numberFormat: 'ddd, d mmm yyyy',
    });
  });

  it('refuses codes that do not show dates or times', () => {
    const onSave = vi.fn();
    render(() => (
      <DateFormatDialog
        dialog={{ range: 'A1', numberFormat: 'mmm yyyy' }}
        onSave={onSave}
        onClose={() => {}}
        onRestoreFocus={() => {}}
      />
    ));
    expect(screen.getByRole('status').textContent).toBe('Preview: Sep 2026');
    fireEvent.input(screen.getByRole('textbox', { name: 'Format code' }), {
      target: { value: '#,##0.00' },
    });
    expect(screen.getByRole('status').textContent).toContain(
      'Use date or time codes'
    );
    expect(
      screen.getByRole('button', { name: 'Apply' }).hasAttribute('disabled')
    ).toBe(true);
    fireEvent.submit(screen.getByRole('dialog').querySelector('form')!);
    expect(onSave).not.toHaveBeenCalled();
  });
});
