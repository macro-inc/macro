import type { PropertyEntitySelector } from '@property/editors/selectors/PropertyEntitySelector';
import { cleanup, render } from '@solidjs/testing-library';
import type { ComponentProps } from 'solid-js';
import { createSignal } from 'solid-js';
import { afterEach, expect, it, vi } from 'vitest';
import { EventGuestPicker } from './EventGuestsEditor';
import type { SelectedEventEditorGuest } from './event-form-model';
import { eventGuestOptions } from './guest-options';

let picker: ComponentProps<typeof PropertyEntitySelector> | undefined;
vi.mock('@property/editors/selectors/PropertyEntitySelector', () => ({
  PropertyEntitySelector: (
    props: ComponentProps<typeof PropertyEntitySelector>
  ) => {
    picker = props;
    return null;
  },
}));
afterEach(() => {
  cleanup();
  picker = undefined;
});

it('preserves explicit selections and names for newly selected off-window people', () => {
  const original: SelectedEventEditorGuest = {
    kind: 'custom',
    id: 'macro|EXISTING@example.com',
    data: {
      id: 'macro|EXISTING@example.com',
      email: 'EXISTING@example.com',
      invalid: false,
    },
  };
  const [selected, setSelected] = createSignal<SelectedEventEditorGuest[]>([
    original,
  ]);
  render(() => (
    <EventGuestPicker
      options={() => []}
      selected={selected()}
      onChange={setSelected}
      onClose={() => {}}
    />
  ));
  expect(picker?.config.users).toBeUndefined();
  expect(picker?.selectedOptions()).toEqual(
    new Set(['macro|existing@example.com'])
  );
  picker?.onUserSelected?.(
    {
      id: 'macro|late@example.com',
      email: 'late@example.com',
      name: 'Resolved private name',
    },
    false
  );
  picker?.setSelectedOptions(
    new Set(['macro|existing@example.com', 'macro|late@example.com'])
  );
  expect(selected()[0]).toBe(original);
  expect(selected()[1]).toMatchObject({
    kind: 'user',
    data: { name: 'Resolved private name', email: 'late@example.com' },
  });
  picker?.onUserSelected?.(
    {
      id: 'macro|Custom$@example.com',
      email: 'Custom$@example.com',
      name: 'Custom$@example.com',
    },
    true
  );
  picker?.setSelectedOptions(
    new Set([...picker.selectedOptions(), 'macro|Custom$@example.com'])
  );
  expect(selected()[0]).toBe(original);
  expect(selected()[1].data).toMatchObject({ name: 'Resolved private name' });
  expect(selected()[2]).toMatchObject({
    kind: 'custom',
    data: { email: 'Custom$@example.com', invalid: false },
  });
});

it('uses canonical eligibility keys without changing the event-owned guest data', () => {
  const current = eventGuestOptions([
    { email: 'CURRENT@example.com', name: 'Event name' },
  ]);
  render(() => (
    <EventGuestPicker
      options={() => current}
      selected={[]}
      excluded={current}
      onChange={() => {}}
      onClose={() => {}}
    />
  ));
  expect(picker?.config.excludedIds?.()).toEqual(
    new Set(['macro|current@example.com'])
  );
  expect(picker?.config.additionalUsers?.()).toEqual([
    {
      id: 'macro|current@example.com',
      email: 'CURRENT@example.com',
      name: 'Event name',
    },
  ]);
  expect(current[0].kind).toBe('contact');
  expect(current[0].data).toMatchObject({
    email: 'CURRENT@example.com',
    name: 'Event name',
    type: 'extracted',
  });
  expect(
    eventGuestOptions([
      { email: 'a@example.com', name: 'First' },
      { email: 'A@example.com', name: 'Second' },
    ])
  ).toHaveLength(1);
});
