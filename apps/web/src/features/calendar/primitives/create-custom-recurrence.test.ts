import { createRoot, createSignal } from 'solid-js';
import { describe, expect, it, vi } from 'vitest';
import {
  defaultCustomConfig,
  type RecurrenceConfig,
} from '../utils/recurrence';
import { createCustomRecurrence } from './create-custom-recurrence';

describe('custom recurrence editing', () => {
  it('preserves positional-monthly details while changing independent fields', () => {
    createRoot((dispose) => {
      const start = new Date('2030-01-01T09:00:00');
      const [value, setValue] = createSignal<RecurrenceConfig>({
        ...defaultCustomConfig(start),
        frequency: 'MONTHLY',
        monthlyByDay: { ordinal: -1, weekday: 'FR' },
      });
      const model = createCustomRecurrence({
        get value() {
          return value();
        },
        start,
        allDay: false,
        onChange: setValue,
      });
      model.interval(2);
      model.ends('after');
      expect(value()).toMatchObject({
        frequency: 'MONTHLY',
        interval: 2,
        monthlyByDay: { ordinal: -1, weekday: 'FR' },
        ends: { kind: 'after', count: 13 },
      });
      dispose();
    });
  });

  it('checks permission changes before applying every field edit', () => {
    createRoot((dispose) => {
      const start = new Date('2030-01-01T09:00:00');
      const [disabled, setDisabled] = createSignal(false);
      const onChange = vi.fn();
      const model = createCustomRecurrence({
        value: defaultCustomConfig(start),
        start,
        allDay: false,
        get disabled() {
          return disabled();
        },
        onChange,
      });
      setDisabled(true);
      model.interval(3);
      model.frequency('YEARLY');
      model.toggleDay('MO');
      model.ends('after');
      model.onDate('2030-05-01');
      model.afterCount(4);
      expect(onChange).not.toHaveBeenCalled();
      dispose();
    });
  });
});
