/**
 * @vitest-environment jsdom
 */

import type { PropertyOptionResponse } from '@service-properties/generated/schemas/propertyOptionResponse';
import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TagEditorDialog, type TagEditorDialogMode } from './TagEditorDialog';

vi.mock('@core/mobile/isMobile', () => ({ isMobile: () => false }));
vi.mock('@queries/properties/tags', () => {
  const mutation = () => ({ isPending: false, mutate: vi.fn() });
  return {
    useCreateTagMutation: mutation,
    useDeletePropertyOptionMutation: mutation,
    useUpdatePropertyOptionMutation: mutation,
  };
});

let motionStyles: HTMLStyleElement;
beforeEach(() => {
  motionStyles = document.createElement('style');
  // jsdom never fires animation events, so presence would keep closed dialogs mounted.
  motionStyles.textContent =
    '* { transition-duration: 0s; animation-name: none; }';
  document.head.append(motionStyles);
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  );
});

afterEach(() => {
  cleanup();
  motionStyles.remove();
  vi.unstubAllGlobals();
});

function renderEditor(mode: TagEditorDialogMode) {
  render(() => <TagEditorDialog open mode={mode} onClose={() => {}} />);
  return screen.findByPlaceholderText('Tag name');
}

describe('TagEditorDialog', () => {
  it('focuses the name field when creating a tag', async () => {
    const name = await renderEditor({ type: 'create', initialScope: 'user' });
    await vi.waitFor(() => expect(document.activeElement).toBe(name));
  });

  it('focuses the name field again when the create dialog reopens', async () => {
    const [mode, setMode] = createSignal<TagEditorDialogMode | null>(null);
    const create: TagEditorDialogMode = {
      type: 'create',
      initialScope: 'user',
    };
    render(() => (
      <TagEditorDialog
        open={mode() !== null}
        mode={mode()}
        onClose={() => setMode(null)}
      />
    ));

    for (let attempt = 0; attempt < 2; attempt++) {
      setMode(create);
      const name = await screen.findByPlaceholderText('Tag name');
      await vi.waitFor(() => expect(document.activeElement).toBe(name));
      fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
      await vi.waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    }
  });

  it('leaves the name field unfocused when editing a tag', async () => {
    const name = await renderEditor({
      type: 'edit',
      tag: {
        scope: 'user',
        propertyDefinitionId: 'definition',
        option: {
          id: 'urgent',
          propertyDefinitionId: 'definition',
          displayOrder: 0,
          value: { type: 'string', value: 'Urgent' },
        } as PropertyOptionResponse,
      },
    });
    await vi.waitFor(() =>
      expect(screen.getByRole('dialog').contains(document.activeElement)).toBe(
        true
      )
    );
    expect(document.activeElement).not.toBe(name);
  });
});
