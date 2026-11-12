import { createRoot, createSignal } from 'solid-js';
import { expect, it, vi } from 'vitest';
import { createRecipientSelection } from './recipient-selection';

it('keeps explicit metadata without turning it into evidence for a different inferred value', () => {
  createRoot((dispose) => {
    try {
      const [value, setValue] = createSignal('');
      const resolve = vi.fn((text: string) =>
        text ? [{ id: text, name: 'Unresolved' }] : []
      );
      const selection = createRecipientSelection(
        value,
        resolve,
        (items) => items.map((item) => item.id).join(','),
        setValue
      );
      selection.select([{ id: 'person', name: 'Chosen private name' }]);
      expect(selection.selected()).toEqual([
        { id: 'person', name: 'Chosen private name' },
      ]);
      const chosen = selection.selected();
      expect(selection.selected()).toBe(chosen);
      setValue('other');
      expect(selection.selected()).toEqual([
        { id: 'other', name: 'Unresolved' },
      ]);
      setValue('person');
      expect(selection.selected()).toEqual([
        { id: 'person', name: 'Unresolved' },
      ]);
      selection.select([]);
      expect(selection.selected()).toEqual([]);
      expect(value()).toBe('');
    } finally {
      dispose();
    }
  });
});
