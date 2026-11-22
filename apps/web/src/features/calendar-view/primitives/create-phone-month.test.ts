import { createRoot, createSignal } from 'solid-js';
import { expect, it } from 'vitest';
import { createPhoneMonth } from './create-phone-month';

it('drops a picked date when a recycled page moves to a different month', () =>
  createRoot((dispose) => {
    const [month, setMonth] = createSignal(new Date(2030, 10, 1));
    const [start, setStart] = createSignal(new Date(2030, 9, 27));
    const model = createPhoneMonth({
      month,
      start,
      initialDate: new Date(2030, 10, 18),
      events: () => [],
      showWeekends: () => true,
      focusDate: () => undefined,
    });
    model.pick(new Date(2030, 10, 30));
    setMonth(new Date(2030, 11, 1));
    setStart(new Date(2030, 10, 24));
    expect(model.selected().getMonth()).toBe(11);
    expect(model.selected().getDate()).toBe(1);
    dispose();
  }));
it('honors hidden weekends and a focused date without losing the six-week data window', () =>
  createRoot((dispose) => {
    const model = createPhoneMonth({
      month: () => new Date(2030, 10, 1),
      start: () => new Date(2030, 9, 27),
      initialDate: new Date(2030, 10, 18),
      events: () => [],
      showWeekends: () => false,
      focusDate: () => new Date(2030, 10, 20),
    });
    expect(model.days()).toHaveLength(30);
    expect(model.weekdays()).toHaveLength(5);
    expect(
      model
        .days()
        .every(({ date }) => date.getDay() !== 0 && date.getDay() !== 6)
    ).toBe(true);
    expect(model.selected().getDate()).toBe(20);
    dispose();
  }));

it('bounds a five-week face without selecting a focus from the unused sixth week', () =>
  createRoot((dispose) => {
    const model = createPhoneMonth({
      month: () => new Date(2026, 10, 1),
      start: () => new Date(2026, 10, 1),
      dayCount: () => 35,
      initialDate: new Date(2026, 10, 20),
      events: () => [],
      showWeekends: () => true,
      focusDate: () => new Date(2026, 11, 8),
    });
    expect(model.days()).toHaveLength(35);
    expect(model.selected()).toEqual(new Date(2026, 10, 20));
    dispose();
  }));
