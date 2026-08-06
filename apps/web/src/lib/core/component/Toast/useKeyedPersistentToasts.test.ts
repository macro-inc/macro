/**
 * @vitest-environment jsdom
 */

import { createRoot, createSignal } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  toastCustom: vi.fn(),
  toastDismiss: vi.fn(),
}));

vi.mock('./Toast', () => ({
  toast: {
    custom: mocks.toastCustom,
    dismiss: mocks.toastDismiss,
  },
}));

import { useKeyedPersistentToasts } from './useKeyedPersistentToasts';

type Item = { id: string; label: string };

type ToastOptions = { persistent?: boolean; onDismiss?: () => void };

function lastToastOptions(): ToastOptions {
  return mocks.toastCustom.mock.calls.at(-1)?.[1] as ToastOptions;
}

describe('useKeyedPersistentToasts', () => {
  let nextToastId: number;

  beforeEach(() => {
    nextToastId = 1;
    mocks.toastCustom.mockImplementation(() => nextToastId++);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  function mount(initial: Item[]) {
    let setItems!: (items: Item[]) => void;
    let dispose!: () => void;
    createRoot((d) => {
      dispose = d;
      const [items, set] = createSignal(initial);
      setItems = set;
      useKeyedPersistentToasts<Item>({
        items,
        key: (item) => item.id,
        toast: (item, dismiss) => ({
          title: item.label,
          actions: [{ label: 'Go', onClick: dismiss }],
        }),
      });
    });
    return { setItems, dispose };
  }

  it('shows one persistent toast per item and no duplicates on re-run', () => {
    const { setItems, dispose } = mount([
      { id: 'a', label: 'A' },
      { id: 'b', label: 'B' },
    ]);
    expect(mocks.toastCustom).toHaveBeenCalledTimes(2);
    expect(lastToastOptions().persistent).toBe(true);

    setItems([
      { id: 'a', label: 'A' },
      { id: 'b', label: 'B' },
    ]);
    expect(mocks.toastCustom).toHaveBeenCalledTimes(2);
    dispose();
  });

  it('dismisses the toast when its item leaves the set', () => {
    const { setItems, dispose } = mount([{ id: 'a', label: 'A' }]);
    setItems([]);
    expect(mocks.toastDismiss).toHaveBeenCalledWith(1);
    dispose();
  });

  it('does not re-prompt a user-dismissed key until it leaves and returns', () => {
    const item = { id: 'a', label: 'A' };
    const { setItems, dispose } = mount([item]);
    lastToastOptions().onDismiss?.();

    setItems([]);
    setItems([{ ...item }]);
    // Left the set and came back: prompts again.
    expect(mocks.toastCustom).toHaveBeenCalledTimes(2);

    lastToastOptions().onDismiss?.();
    setItems([{ ...item, label: 'A2' }]);
    // Still in the set after dismissal: stays suppressed.
    expect(mocks.toastCustom).toHaveBeenCalledTimes(2);
    dispose();
  });

  it('suppresses re-prompting after the action-provided dismiss handle runs', () => {
    const item = { id: 'a', label: 'A' };
    const { setItems, dispose } = mount([item]);
    const config = mocks.toastCustom.mock.calls[0][0] as {
      actions: { onClick: () => void }[];
    };
    config.actions[0].onClick();
    expect(mocks.toastDismiss).toHaveBeenCalledWith(1);

    setItems([{ ...item }]);
    expect(mocks.toastCustom).toHaveBeenCalledTimes(1);
    dispose();
  });

  it('dismisses all live toasts on owner cleanup', () => {
    const { dispose } = mount([
      { id: 'a', label: 'A' },
      { id: 'b', label: 'B' },
    ]);
    dispose();
    expect(mocks.toastDismiss).toHaveBeenCalledWith(1);
    expect(mocks.toastDismiss).toHaveBeenCalledWith(2);
  });
});
