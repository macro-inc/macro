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
import { promptSection } from './SectionDialog';

vi.mock('@core/mobile/isMobile', () => ({ isMobile: () => false }));
vi.mock('@ui', async () => ({
  ...(await import('@app/components/ui/components/ImperativeDialog')),
  ...(await import('@app/components/ui/components/Dialog')),
  cn: (...values: unknown[]) => values.filter(Boolean).join(' '),
  Layer: (props: ParentProps) => props.children,
  Surface: (props: ParentProps) => <div>{props.children}</div>,
  ToggleSwitch: (await import('@app/components/ui/components/ToggleSwitch'))
    .ToggleSwitch,
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
    const result = promptSection({
      canShare: false,
      onConfirm,
    });
    const input = screen.getByRole('textbox', {
      name: 'Section name',
    }) as HTMLInputElement;
    fireEvent.input(input, { target: { value: '  My group  ' } });
    fireEvent.submit(input.closest('form')!);
    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toContain('already exists')
    );
    expect(input.value).toBe('  My group  ');
    expect(onConfirm).toHaveBeenCalledWith({
      name: 'My group',
      scope: 'personal',
    });
    fireEvent.input(input, { target: { value: 'New name' } });
    fireEvent.submit(input.closest('form')!);
    fireEvent.submit(input.closest('form')!);
    expect(onConfirm).toHaveBeenCalledTimes(2);
    expect(
      screen.getByRole('button', { name: 'Cancel' }).hasAttribute('disabled')
    ).toBe(true);
    expect(
      screen.queryByRole('switch', { name: 'Shared with team' })
    ).toBeNull();
    expect(
      screen
        .getByRole('switch', { name: 'Smart section' })
        .hasAttribute('disabled')
    ).toBe(true);
    expect(screen.getByRole('dialog', { name: 'New section' })).toBeTruthy();
    finish();
    await result;
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('cancel never saves, and reopening accepts a fresh name', async () => {
    render(() => <ImperativeDialogHost />);
    const onConfirm = vi.fn(async () => {});
    const props = {
      canShare: false,
      onConfirm,
    };
    const first = promptSection(props);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await first;
    expect(onConfirm).not.toHaveBeenCalled();
    const next = promptSection(props);
    const input = screen.getByRole('textbox', {
      name: 'Section name',
    }) as HTMLInputElement;
    expect(input.value).toBe('');
    fireEvent.input(input, { target: { value: 'Second group' } });
    fireEvent.submit(input.closest('form')!);
    await next;
    expect(onConfirm).toHaveBeenCalledWith({
      name: 'Second group',
      scope: 'personal',
    });
  });

  it('creates a shared manual section and keeps visibility and kind fixed when editing', async () => {
    render(() => <ImperativeDialogHost />);
    const onConfirm = vi.fn(async () => {});
    const create = promptSection({ canShare: true, onConfirm });
    fireEvent.click(screen.getByRole('switch', { name: 'Shared with team' }));
    fireEvent.input(screen.getByRole('textbox', { name: 'Section name' }), {
      target: { value: 'Team updates' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create section' }));
    await create;
    expect(onConfirm).toHaveBeenCalledWith({
      name: 'Team updates',
      scope: 'team',
    });

    const edit = promptSection({
      canShare: true,
      scope: 'team',
      initial: { name: 'Team updates' },
      onConfirm,
    });
    expect(
      screen.queryByRole('switch', { name: 'Shared with team' })
    ).toBeNull();
    expect(screen.queryByRole('switch', { name: 'Smart section' })).toBeNull();
    fireEvent.input(screen.getByRole('textbox', { name: 'Section name' }), {
      target: { value: 'Project updates' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save section' }));
    await edit;
    expect(onConfirm).toHaveBeenLastCalledWith({
      name: 'Project updates',
      scope: 'team',
    });
  });
});
