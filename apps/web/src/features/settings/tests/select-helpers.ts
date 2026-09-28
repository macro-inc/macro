import { fireEvent, screen, within } from '@solidjs/testing-library';

function openSelect(trigger: HTMLElement) {
  fireEvent.keyDown(trigger, { key: 'ArrowDown' });
  const listbox = screen
    .getAllByRole('listbox')
    .find((element) => element.getAttribute('aria-labelledby') === trigger.id);
  if (!listbox) throw new Error('No listbox labelled by the select trigger');
  return listbox;
}

/** Inspect the portalled options, then close the menu without changing it. */
export function selectOptions(trigger: HTMLElement) {
  const listbox = openSelect(trigger);
  fireEvent.keyDown(listbox, { key: 'Escape' });
  return within(listbox);
}

export function chooseSelectOption(trigger: HTMLElement, name: string) {
  const listbox = openSelect(trigger);
  fireEvent.click(within(listbox).getByRole('option', { name }));
}
