import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { afterEach, expect, it } from 'vitest';
import type { FormCellValue } from '../../core/form-model';
import { QuestionField } from './question-field';

afterEach(cleanup);

it('records a checkbox answer as true or an explicit false once touched, and keeps a saved false', () => {
  const [value, setValue] = createSignal<FormCellValue | undefined>({
    type: 'boolean',
    value: false,
  });
  const changes: (FormCellValue | undefined)[] = [];
  render(() => (
    <QuestionField
      scope="respond-1"
      question={{
        id: 'q-vegan',
        columnId: 'vegan',
        helpText: '',
        required: true,
        widget: null,
      }}
      column={{
        id: 'vegan',
        name: 'Vegan?',
        kind: { type: 'boolean' },
        options: [],
      }}
      widget={null}
      number={1}
      value={value()}
      problem={undefined}
      disabled={false}
      compact={false}
      upload={async () => undefined}
      renderEntityPicker={() => null}
      renderRelationPicker={() => null}
      onChange={(next) => {
        changes.push(next);
        setValue(next);
      }}
    />
  ));
  const box = screen.getByRole<HTMLInputElement>('checkbox');
  expect(box.checked).toBe(false);
  fireEvent.click(box);
  fireEvent.click(box);
  expect(changes).toEqual([
    { type: 'boolean', value: true },
    { type: 'boolean', value: false },
  ]);
});

it('keeps single-choice answers exclusive and clears the themed radio selection', () => {
  const [value, setValue] = createSignal<FormCellValue>();
  const [disabled, setDisabled] = createSignal(false);
  render(() => (
    <QuestionField
      scope="respond-choice"
      question={{
        id: 'q-event',
        columnId: 'event',
        helpText: 'Choose one event type.',
        required: false,
        widget: null,
      }}
      column={{
        id: 'event',
        name: 'Event type',
        kind: { type: 'select', multi: false },
        options: [
          { id: 'conference', label: 'Conference', color: null },
          { id: 'offsite', label: 'Team offsite', color: null },
        ],
      }}
      widget={null}
      number={1}
      value={value()}
      problem={undefined}
      disabled={disabled()}
      compact={false}
      upload={async () => undefined}
      renderEntityPicker={() => null}
      renderRelationPicker={() => null}
      onChange={setValue}
    />
  ));
  const conference = screen.getByRole<HTMLInputElement>('radio', {
    name: 'Conference',
  });
  const offsite = screen.getByRole<HTMLInputElement>('radio', {
    name: 'Team offsite',
  });
  expect(screen.getByRole('radiogroup', { name: 'Event type' })).toBeTruthy();
  fireEvent.click(conference);
  fireEvent.click(offsite);
  expect(value()).toEqual({ type: 'options', value: [{ id: 'offsite' }] });
  expect(conference.checked).toBe(false);
  expect(offsite.checked).toBe(true);
  const clear = screen.getByRole<HTMLButtonElement>('button', {
    name: 'Clear selection',
  });
  setDisabled(true);
  expect(clear.disabled).toBe(true);
  expect(screen.getByRole('button', { name: 'Clear selection' })).toBe(clear);
  expect(offsite.checked).toBe(true);
  setDisabled(false);
  fireEvent.click(clear);
  expect(value()).toBeUndefined();
  expect(conference.checked).toBe(false);
  expect(offsite.checked).toBe(false);
  setDisabled(true);
  expect(conference.disabled).toBe(true);
  expect(offsite.disabled).toBe(true);
});

it('keeps multiple-choice answers independent with themed checkboxes', () => {
  const [value, setValue] = createSignal<FormCellValue>();
  render(() => (
    <QuestionField
      scope="respond-multiple"
      question={{
        id: 'q-services',
        columnId: 'services',
        helpText: '',
        required: false,
        widget: null,
      }}
      column={{
        id: 'services',
        name: 'Services',
        kind: { type: 'select', multi: true },
        options: [
          { id: 'catering', label: 'Catering', color: null },
          { id: 'venue', label: 'Venue', color: null },
        ],
      }}
      widget={null}
      number={1}
      value={value()}
      problem={undefined}
      disabled={false}
      compact={false}
      upload={async () => undefined}
      renderEntityPicker={() => null}
      renderRelationPicker={() => null}
      onChange={setValue}
    />
  ));
  const catering = screen.getByRole<HTMLInputElement>('checkbox', {
    name: 'Catering',
  });
  const venue = screen.getByRole<HTMLInputElement>('checkbox', {
    name: 'Venue',
  });
  fireEvent.click(catering);
  fireEvent.click(venue);
  expect(value()).toEqual({
    type: 'options',
    value: [{ id: 'catering' }, { id: 'venue' }],
  });
  fireEvent.click(catering);
  expect(value()).toEqual({ type: 'options', value: [{ id: 'venue' }] });
  expect(catering.checked).toBe(false);
  expect(venue.checked).toBe(true);
});
