import { ImperativeDialogHost } from '@app/components/ui/components/ImperativeDialog';
import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import type { ComponentProps, ParentProps } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { openSectionConflict } from './SectionConflictDialog';

vi.mock('@core/mobile/isMobile', () => ({ isMobile: () => false }));
vi.mock('@core/mobile/isTouchDevice', () => ({ isTouchDevice: () => false }));
vi.mock('@ui', async () => ({
  ...(await import('@app/components/ui/components/ImperativeDialog')),
  ...(await import('@app/components/ui/components/Dialog')),
  ...(await import('@app/components/ui/components/Checkbox')),
  ...(await import('@app/components/ui/components/ActionDialogShell')),
  cn: (...values: unknown[]) => values.filter(Boolean).join(' '),
  Layer: (props: ParentProps) => props.children,
  Button: (props: ComponentProps<'button'>) => (
    <button type={props.type} disabled={props.disabled} onClick={props.onClick}>
      {props.children}
    </button>
  ),
}));

beforeEach(() => {
  vi.stubGlobal('scrollTo', vi.fn());
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function open() {
  render(() => <ImperativeDialogHost />);
  const onConfirm = vi.fn();
  openSectionConflict({
    sectionName: 'Engineering',
    change: 'kinds',
    channels: [
      { id: 'backend', name: 'eng-backend' },
      { id: 'frontend', name: 'eng-frontend' },
    ],
    onConfirm,
  });
  return onConfirm;
}

const button = (name: string) =>
  screen.getByRole('button', { name }) as HTMLButtonElement;

describe('section conflict dialog', () => {
  it('lists the channels unselected; OK keeps their own settings', () => {
    const onConfirm = open();

    expect(screen.getByText(/2 channels in Engineering/)).toBeTruthy();
    for (const box of screen.getAllByRole('checkbox')) {
      expect((box as HTMLInputElement).checked).toBe(false);
    }
    expect(button('Override').disabled).toBe(true);

    fireEvent.click(button('OK'));

    expect(onConfirm).toHaveBeenCalledWith([]);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('overrides only the channels selected', () => {
    const onConfirm = open();

    fireEvent.click(screen.getByText('eng-frontend'));
    fireEvent.click(button('Override'));

    expect(onConfirm).toHaveBeenCalledWith(['frontend']);
  });

  it('selects every channel at once', () => {
    const onConfirm = open();

    fireEvent.click(button('Select all'));
    expect(button('Select all').disabled).toBe(true);
    fireEvent.click(button('Override'));

    expect(onConfirm).toHaveBeenCalledWith(['backend', 'frontend']);
  });

  it('cancel saves nothing', () => {
    const onConfirm = open();

    fireEvent.click(button('Cancel'));

    expect(onConfirm).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
