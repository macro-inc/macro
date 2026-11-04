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

function openModelMenu(trigger: HTMLElement) {
  fireEvent.keyDown(trigger, { key: 'Enter' });
  const menu = screen
    .getAllByRole('menu')
    .find((element) => element.getAttribute('aria-labelledby') === trigger.id);
  if (!menu) throw new Error('No model menu labelled by the picker trigger');
  return menu;
}

/** Inspect a model picker's rows, then close it without changing it. */
export function modelOptions(trigger: HTMLElement) {
  const menu = openModelMenu(trigger);
  fireEvent.keyDown(menu, { key: 'Escape' });
  return within(menu);
}

export function chooseModelOption(trigger: HTMLElement, name: string) {
  const menu = openModelMenu(trigger);
  const item = within(menu).getByRole('menuitem', { name });
  item.focus();
  fireEvent.keyDown(item, { key: 'Enter' });
}
