import { createSignal } from 'solid-js';

export const tabTitleSignal = createSignal<string | undefined>();

export function formatTabTitle(title: string | undefined) {
  if (title) return `Macro - ${title}`;
  return `Macro`;
}
