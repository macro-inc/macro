import { createStore } from 'solid-js/store';

export type ComposerOptionalField = 'description' | 'location';

/** Adding a field changes presentation only; existing values always remain visible. */
export function createComposerOptionalFields(options: {
  value: (field: ComposerOptionalField) => string;
  disabled: (field: ComposerOptionalField) => boolean;
}) {
  const [opened, setOpened] = createStore({
    description: false,
    location: false,
  });
  return {
    visible: (field: ComposerOptionalField) =>
      opened[field] || options.value(field).length > 0,
    reveal: (field: ComposerOptionalField) => {
      if (options.disabled(field)) return false;
      setOpened(field, true);
      return true;
    },
  };
}
