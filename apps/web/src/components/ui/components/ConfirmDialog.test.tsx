import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { createRoot, createSignal, getOwner, type ParentProps } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConfirmDialog, confirmDialog } from './ConfirmDialog';
import { ImperativeDialogHost } from './ImperativeDialog';

const mobile = vi.hoisted(() => ({ value: true }));
vi.mock('@core/mobile/isMobile', () => ({ isMobile: () => mobile.value }));
vi.mock('@ui', () => ({
  cn: (...values: unknown[]) => values.filter(Boolean).join(' '),
  Layer: (props: ParentProps) => props.children,
}));

beforeEach(() => {
  mobile.value = true;
  vi.useFakeTimers();
  vi.stubGlobal('scrollTo', vi.fn());
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe = vi.fn();
      unobserve = vi.fn();
      disconnect = vi.fn();
    }
  );
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('controlled confirmation', () => {
  it('stays open while pending and can reopen after dismissal', () => {
    const [open, setOpen] = createSignal(true);
    const [pending, setPending] = createSignal(false);
    const onConfirm = vi.fn(() => setPending(true));
    render(() => (
      <ConfirmDialog
        title="Remove Member"
        body="Remove this member?"
        open={open()}
        onOpenChange={setOpen}
        pending={pending()}
        onConfirm={onConfirm}
      />
    ));

    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    expect(onConfirm).toHaveBeenCalledOnce();
    expect(open()).toBe(true);
    expect(screen.getByRole('dialog', { name: 'Remove Member' })).toBeTruthy();
    for (const name of ['Confirm', 'Cancel', 'Close confirmation']) {
      expect(
        screen.getByRole('button', { name }).hasAttribute('disabled')
      ).toBe(true);
    }

    setPending(false);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(open()).toBe(false);
    setOpen(true);
    expect(screen.getByRole('dialog', { name: 'Remove Member' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    expect(onConfirm).toHaveBeenCalledTimes(2);
  });
});

describe('imperative confirmation', () => {
  it.each([
    ['Confirm', true],
    ['Cancel', false],
    ['Close confirmation', false],
  ] as const)(
    'resolves %s after the mobile closing animation',
    async (name, choice) => {
      render(() => <ImperativeDialogHost />);
      const result = confirmDialog({ title: 'Start call?' });
      const resolved = vi.fn();
      const resolution = (async () => resolved(await result))();

      fireEvent.click(screen.getByRole('button', { name }));
      await vi.advanceTimersByTimeAsync(249);
      expect(resolved).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);
      expect(await result).toBe(choice);
      await resolution;
      expect(resolved).toHaveBeenCalledOnce();
    }
  );

  it('resolves immediately on desktop', async () => {
    mobile.value = false;
    render(() => <ImperativeDialogHost />);
    const result = confirmDialog({ title: 'Start call?' });
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    expect(await result).toBe(true);
  });

  it('cancels an unfinished confirmation when its owner is disposed', async () => {
    render(() => <ImperativeDialogHost />);
    const { dispose, result } = createRoot((dispose) => ({
      dispose,
      result: confirmDialog({ title: 'Start call?' }, { owner: getOwner() }),
    }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    dispose();
    expect(await result).toBe(false);
    await vi.advanceTimersByTimeAsync(250);
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
