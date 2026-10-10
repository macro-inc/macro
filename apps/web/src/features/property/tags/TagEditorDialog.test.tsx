/**
 * @vitest-environment jsdom
 */

import type { PropertyOptionResponse } from '@service-properties/generated/schemas/propertyOptionResponse';
import { cleanup, render, screen } from '@solidjs/testing-library';
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

beforeEach(() => {
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
