import { createRoot } from 'solid-js';
import { expect, it } from 'vitest';
import { createSelectionDismissal } from './selectionDismissal';

it('preserves Shift across microtask checkpoints until the next keyboard event', async () => {
  const element = document.createElement('div');
  let dispose!: () => void;
  const selection = createRoot((cleanup) => {
    dispose = cleanup;
    const selection = createSelectionDismissal();
    selection.track(element);
    return selection;
  });
  try {
    element.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', shiftKey: true })
    );
    // Native events can have a checkpoint between capture and selection.
    await Promise.resolve();
    expect(selection.shouldClose()).toBe(false);
    element.dispatchEvent(new KeyboardEvent('keyup', { key: 'Shift' }));
    element.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    expect(selection.shouldClose()).toBe(true);
  } finally {
    dispose();
  }
});
