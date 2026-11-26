import { createStore } from 'solid-js/store';

export type ComposerOptionalField = 'description' | 'location';

/** Adding a field changes presentation only; existing values always remain visible. */
export function createComposerOptionalFields(options: {
  value: (field: ComposerOptionalField) => string;
  disabled: (field: ComposerOptionalField) => boolean;
}) {
  const initiallyVisible = {
    description: options.value('description').trim().length > 0,
    location: options.value('location').trim().length > 0,
  };
  const [opened, setOpened] = createStore({ ...initiallyVisible });
  const empty = (field: ComposerOptionalField) =>
    options.value(field).trim().length === 0;
  return {
    initiallyVisible: (field: ComposerOptionalField) => initiallyVisible[field],
    empty,
    remove: (field: ComposerOptionalField) => {
      if (!empty(field) || options.disabled(field)) return false;
      setOpened(field, false);
      return true;
    },
    visible: (field: ComposerOptionalField) => opened[field] || !empty(field),
    reveal: (field: ComposerOptionalField) => {
      if (options.disabled(field)) return false;
      setOpened(field, true);
      return true;
    },
  };
}
