/**
 * @vitest-environment jsdom
 */

import { render, screen, waitFor } from '@solidjs/testing-library';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ModelCatalogPicker } from './ModelCatalogPicker';

const OPTIONS = Array.from({ length: 11 }, (_, index) => ({
  id: `model-${index}`,
  label: `Model ${index}`,
}));

describe('ModelCatalogPicker focus', () => {
  it('focuses search on open and delegates focus restoration after Escape', async () => {
    const user = userEvent.setup();
    const restoreComposerFocus = vi.fn(() => composer.focus());
    let composer!: HTMLButtonElement;

    render(() => (
      <>
        <button ref={composer} type="button">
          Agent composer
        </button>
        <ModelCatalogPicker
          value={OPTIONS[0]!.id}
          options={OPTIONS}
          onSelect={() => {}}
          onEscape={restoreComposerFocus}
          ariaLabel="Agent model"
        />
      </>
    ));

    await user.click(screen.getByRole('button', { name: 'Agent model' }));

    const search = await screen.findByRole('textbox', {
      name: 'Search models',
    });
    await waitFor(() => expect(document.activeElement).toBe(search));

    await user.keyboard('{Escape}');

    await waitFor(() => {
      expect(restoreComposerFocus).toHaveBeenCalledOnce();
      expect(document.activeElement).toBe(composer);
    });
  });
});
