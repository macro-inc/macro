import { createRoot } from 'solid-js';
import { describe, expect, it } from 'vitest';
import { createComposerOptionalFields } from './create-composer-optional-fields';

describe('optional composer fields', () => {
  it('retains an explicitly added empty field and reveals late values', () => {
    createRoot((dispose) => {
      let description = '';
      const fields = createComposerOptionalFields({
        value: (field) => (field === 'description' ? description : ''),
        disabled: () => false,
      });
      expect(fields.visible('description')).toBe(false);
      description = '<p>Suggested notes</p>';
      expect(fields.visible('description')).toBe(true);
      description = '';
      expect(fields.reveal('description')).toBe(true);
      expect(fields.visible('description')).toBe(true);
      expect(fields.visible('location')).toBe(false);
      dispose();
    });
  });
  it('only removes empty unlocked fields and retains the original slot', () => {
    createRoot((dispose) => {
      let value = 'Existing notes';
      let disabled = false;
      const fields = createComposerOptionalFields({
        value: () => value,
        disabled: () => disabled,
      });
      expect(fields.initiallyVisible('description')).toBe(true);
      expect(fields.remove('description')).toBe(false);
      value = '';
      disabled = true;
      expect(fields.remove('description')).toBe(false);
      disabled = false;
      expect(fields.remove('description')).toBe(true);
      expect(fields.visible('description')).toBe(false);
      expect(fields.initiallyVisible('description')).toBe(true);
      fields.reveal('description');
      expect(fields.visible('description')).toBe(true);
      dispose();
    });
  });
  it('never reveals a disabled field through its add action', () => {
    createRoot((dispose) => {
      const fields = createComposerOptionalFields({
        value: () => '',
        disabled: () => true,
      });
      expect(fields.reveal('location')).toBe(false);
      expect(fields.visible('location')).toBe(false);
      dispose();
    });
  });
});
