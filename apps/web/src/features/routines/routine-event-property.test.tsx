import {
  PROPERTY_OPTION_IDS,
  SYSTEM_PROPERTY_IDS,
} from '@property/identifiers';
import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RoutineEventPropertyValues } from './routine-event-property';

const COMPLETED = PROPERTY_OPTION_IDS.STATUS.COMPLETED;
const CANCELED = PROPERTY_OPTION_IDS.STATUS.CANCELED;

vi.mock('@queries/properties/options', () => ({
  usePropertyOptionsQuery: () => ({
    isSuccess: true,
    isError: false,
    data: [
      { id: COMPLETED, value: { type: 'string', value: 'Completed' } },
      { id: CANCELED, value: { type: 'string', value: 'Canceled' } },
    ],
  }),
}));

function mount() {
  const [values, setValues] = createSignal<string[]>([]);
  render(() => (
    <RoutineEventPropertyValues
      property={{
        definitionId: SYSTEM_PROPERTY_IDS.STATUS,
        anyLabel: 'Any status',
        kind: 'options',
      }}
      values={values()}
      onChange={setValues}
    />
  ));
  return values;
}

function pressed(name: string) {
  return screen.getByRole('button', { name }).getAttribute('aria-pressed');
}

describe('RoutineEventPropertyValues', () => {
  afterEach(cleanup);

  it('starts on any value and collects the values chosen', () => {
    const values = mount();
    expect(pressed('Any status')).toBe('true');

    fireEvent.click(screen.getByRole('button', { name: 'Completed' }));
    fireEvent.click(screen.getByRole('button', { name: 'Canceled' }));
    expect(values()).toEqual([COMPLETED, CANCELED]);
    expect(pressed('Any status')).toBe('false');
    expect(pressed('Completed')).toBe('true');

    fireEvent.click(screen.getByRole('button', { name: 'Completed' }));
    expect(values()).toEqual([CANCELED]);
  });

  it('clears the choice when any value is picked again', () => {
    const values = mount();
    fireEvent.click(screen.getByRole('button', { name: 'Completed' }));
    fireEvent.click(screen.getByRole('button', { name: 'Any status' }));
    expect(values()).toEqual([]);
    expect(pressed('Any status')).toBe('true');
  });
});
