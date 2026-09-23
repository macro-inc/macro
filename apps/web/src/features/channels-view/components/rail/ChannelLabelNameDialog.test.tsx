import { ImperativeDialogHost } from '@app/components/ui/components/ImperativeDialog';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@solidjs/testing-library';
import type { ComponentProps, ParentProps } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { promptLabelName } from './ChannelLabelNameDialog';

vi.mock('@core/mobile/isMobile', () => ({ isMobile: () => false }));
vi.mock('@ui', async () => ({
  ...(await import('@app/components/ui/components/ImperativeDialog')),
  ...(await import('@app/components/ui/components/Dialog')),
  cn: (...values: unknown[]) => values.filter(Boolean).join(' '),
  Layer: (props: ParentProps) => props.children,
  Surface: (props: ParentProps) => <div>{props.children}</div>,
  Input: (props: ComponentProps<'input'>) => <input {...props} />,
  Button: (props: ComponentProps<'button'>) => (
    <button type={props.type} disabled={props.disabled} onClick={props.onClick}>
      {props.children}
    </button>
  ),
}));
beforeEach(() => vi.stubGlobal('scrollTo', vi.fn()));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('label naming', () => {
  it('retains the name after failure, prevents duplicate submits, and closes only after saving', async () => {
    render(() => <ImperativeDialogHost />);
    let finish!: () => void;
    const onConfirm = vi
      .fn()
      .mockRejectedValueOnce(new Error('A label with this name already exists'))
      .mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            finish = resolve;
          })
      );
    const result = promptLabelName({
      title: 'New label',
      body: 'Private',
      confirmLabel: 'Create label',
      onConfirm,
    });
    const input = screen.getByRole('textbox', {
      name: 'Label name',
    }) as HTMLInputElement;
    fireEvent.input(input, { target: { value: '  My group  ' } });
    fireEvent.submit(input.closest('form')!);
    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toContain('already exists')
    );
    expect(input.value).toBe('  My group  ');
    fireEvent.input(input, { target: { value: 'New name' } });
    fireEvent.submit(input.closest('form')!);
    fireEvent.submit(input.closest('form')!);
    expect(onConfirm).toHaveBeenCalledTimes(2);
    expect(screen.getByRole('dialog', { name: 'New label' })).toBeTruthy();
    finish();
    expect(await result).toBe('New name');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('cancel never saves, and reopening accepts a fresh name', async () => {
    render(() => <ImperativeDialogHost />);
    const onConfirm = vi.fn(async () => {});
    const props = {
      title: 'New label',
      body: 'Private',
      confirmLabel: 'Create label',
      onConfirm,
    };
    const first = promptLabelName(props);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(await first).toBeUndefined();
    expect(onConfirm).not.toHaveBeenCalled();
    const next = promptLabelName(props);
    const input = screen.getByRole('textbox', {
      name: 'Label name',
    }) as HTMLInputElement;
    expect(input.value).toBe('');
    fireEvent.input(input, { target: { value: 'Second group' } });
    fireEvent.submit(input.closest('form')!);
    expect(await next).toBe('Second group');
    expect(onConfirm).toHaveBeenCalledWith('Second group');
  });
});
