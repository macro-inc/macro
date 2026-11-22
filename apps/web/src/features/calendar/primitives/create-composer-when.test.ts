import { moveTimedRange } from '@app/components/date-time-range/time-range';
import { createRoot } from 'solid-js';
import { createStore } from 'solid-js/store';
import { expect, it, vi } from 'vitest';
import { createComposerWhen } from './create-composer-when';

function setup(start = '2030-11-13T13:00', end = '2030-11-13T14:00') {
  let revision = 0;
  const [value, setValue] = createStore({
    start,
    end,
    allDay: false,
    startDisabled: false,
    endDisabled: false,
  });
  const range = {
    subject: 'event',
    get start() {
      return value.start;
    },
    get end() {
      return value.end;
    },
    get allDay() {
      return value.allDay;
    },
    get startDisabled() {
      return value.startDisabled;
    },
    get endDisabled() {
      return value.endDisabled;
    },
    onStartChange: (start: string) => setValue(moveTimedRange(value, start)),
    onEndChange: (end: string) => setValue('end', end),
  };
  return {
    value,
    setValue,
    resetRevision: () => {
      revision += 1;
    },
    model: createComposerWhen({
      range,
      setRange: (start, end) => setValue({ start, end }),
      setAllDay: (allDay) => setValue('allDay', allDay),
      detailsRevision: () => revision,
    }),
  };
}
it('keeps length until an end is chosen, then rescues an invalid start', () =>
  createRoot((dispose) => {
    const { model, value } = setup();
    model.start('2030-11-13T14:00');
    expect(value.end).toBe('2030-11-13T15:00');
    model.end('2030-11-13T16:00');
    model.start('2030-11-13T15:00');
    expect(value.end).toBe('2030-11-13T16:00');
    model.start('2030-11-13T17:00');
    expect(value.end).toBe('2030-11-13T18:00');
    dispose();
  }));
it('rejects reversed ends and respects locked endpoints', () =>
  createRoot((dispose) => {
    const { model, value, setValue } = setup();
    model.end('2030-11-13T12:00');
    expect(value.end).toBe('2030-11-13T14:00');
    setValue('endDisabled', true);
    model.start('2030-11-12T13:00');
    expect(value.end).toBe('2030-11-13T14:00');
    model.end('2030-11-14T16:00');
    expect(value.end).toBe('2030-11-13T14:00');
    model.start('2030-11-15T13:00');
    expect(value.start).toBe('2030-11-12T13:00');
    dispose();
  }));
it('offers only valid times on the selected end day and preserves long durations', () =>
  createRoot((dispose) => {
    const { model, setValue } = setup();
    expect(model.timeOptions('end', true)[0].value).toBe('13:15');
    expect(model.timeOptions('end', true).every((t) => t.dayOffset === 0)).toBe(
      true
    );
    setValue('end', '2030-11-14T15:00');
    const next = model.timeOptions('end', true);
    expect(next[0].value).toBe('00:00');
    expect(next.find((t) => t.value === '15:00')?.detail).toBe('26h');
    expect(
      model.timeOptions('end', false).find((option) => option.value === '15:00')
        ?.detail
    ).toBe('26h');
    model.chooseTime('end', next[0]);
    expect(model.timeOptions('end', true)[0].dayOffset).toBe(1);
    dispose();
  }));
it('closes the preceding picker and clears drafts on all-day conversion', () =>
  createRoot((dispose) => {
    const { model, value } = setup(),
      discard = vi.fn();
    model.open('start-time', discard);
    model.open('end-date');
    expect(discard).toHaveBeenCalledOnce();
    expect(model.state.active).toBe('end-date');
    model.close('repeat');
    expect(model.state.active).toBe('end-date');
    model.allDay(true);
    expect(model.state.active).toBeUndefined();
    expect(value.allDay).toBe(true);
    dispose();
  }));

it('clears chosen-end intent after a loaded-detail reset', () =>
  createRoot((dispose) => {
    const { model, value, setValue, resetRevision } = setup();
    model.end('2030-11-13T16:00');
    setValue({ start: '2030-11-13T13:00', end: '2030-11-13T14:00' });
    resetRevision();
    model.start('2030-11-13T13:30');
    expect(value.end).toBe('2030-11-13T14:30');
    dispose();
  }));
it('marks the explicit all-day range end as chosen', () =>
  createRoot((dispose) => {
    const { model, value, setValue } = setup();
    setValue('allDay', true);
    model.range('2030-11-13', '2030-11-15');
    model.start('2030-11-14');
    expect(value.end).toBe('2030-11-15');
    dispose();
  }));

it('moves both wheel endpoints together even after the end was chosen', () =>
  createRoot((dispose) => {
    const { model, value } = setup('2030-11-13T11:00', '2030-11-13T11:30');
    model.end('2030-11-13T12:30');
    model.chooseWheelTime('start', '14:30');
    expect(value.start).toBe('2030-11-13T14:30');
    expect(value.end).toBe('2030-11-13T16:00');
    model.chooseWheelTime('start', '23:30');
    expect(value.end).toBe('2030-11-14T01:00');
    dispose();
  }));
it('stops the end wheel at start plus one five-minute step', () =>
  createRoot((dispose) => {
    const { model, value } = setup('2030-11-13T11:00', '2030-11-13T11:30');
    model.chooseWheelTime('end', '10:30');
    expect(value.end).toBe('2030-11-13T11:05');
    model.chooseWheelTime('end', '11:00');
    expect(value.end).toBe('2030-11-13T11:05');
    model.chooseWheelTime('end', '11:10');
    expect(value.end).toBe('2030-11-13T11:10');
    dispose();
  }));
it('respects locked endpoints and all-day mode during wheel changes', () =>
  createRoot((dispose) => {
    const { model, value, setValue } = setup();
    setValue('endDisabled', true);
    model.chooseWheelTime('start', '12:00');
    expect(value.start).toBe('2030-11-13T12:00');
    expect(value.end).toBe('2030-11-13T14:00');
    model.chooseWheelTime('start', '15:00');
    expect(value.start).toBe('2030-11-13T12:00');
    model.chooseWheelTime('end', '16:00');
    expect(value.end).toBe('2030-11-13T14:00');
    setValue('allDay', true);
    model.chooseWheelTime('start', '11:00');
    expect(value.start).toBe('2030-11-13T12:00');
    dispose();
  }));
