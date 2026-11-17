import { createRoot } from 'solid-js';
import { createStore } from 'solid-js/store';
import { expect, it } from 'vitest';
import { createComposerReminders } from './create-composer-reminders';

it('keeps custom offsets, prevents duplicate additions, and respects the limit', () => {
  createRoot((dispose) => {
    const [state, setState] = createStore({
      minutes: [17, 30],
      canAdd: true,
      disabled: false,
    });
    const reminders = createComposerReminders({
      get minutes() {
        return state.minutes;
      },
      get canAdd() {
        return state.canAdd;
      },
      get disabled() {
        return state.disabled;
      },
      preservedCount: 2,
      onChange: (minutes) => setState('minutes', minutes),
    });
    expect(reminders.offsets()).toContain(17);
    reminders.add(17);
    expect(state.minutes).toEqual([17, 30]);
    reminders.replace(0, '10');
    expect(state.minutes).toEqual([10, 30]);
    reminders.replace(0, 'invalid');
    expect(state.minutes).toEqual([10, 30]);
    setState('canAdd', false);
    reminders.add(60);
    expect(state.minutes).toEqual([10, 30]);
    setState('disabled', true);
    reminders.remove(0);
    reminders.replace(1, '5');
    expect(state.minutes).toEqual([10, 30]);
    setState('disabled', false);
    reminders.remove(0);
    expect(state.minutes).toEqual([30]);
    dispose();
  });
});
