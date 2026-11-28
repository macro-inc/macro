/**
 * @vitest-environment jsdom
 */

import { cleanup, render, screen, waitFor } from '@solidjs/testing-library';
import userEvent from '@testing-library/user-event';
import { Dialog } from '@ui';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { SavedViewForm } from './saved-view-dialog';

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', ResizeObserverStub);
  // The dialog's scroll lock restores the page scroll on close.
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

it('replaces the prefilled name when the user types', async () => {
  const onSave = vi.fn();
  render(() => (
    <Dialog open onOpenChange={() => {}}>
      <SavedViewForm
        name="New view"
        pending={false}
        onOpenChange={() => {}}
        onSave={onSave}
      />
    </Dialog>
  ));
  const name = await screen.findByRole('textbox', { name: 'Name' });
  await waitFor(() => expect(document.activeElement).toBe(name));

  // Type into the focused field as it opened, without clicking it first.
  await userEvent.setup().keyboard('Explore view');

  expect(name).toHaveProperty('value', 'Explore view');
});
