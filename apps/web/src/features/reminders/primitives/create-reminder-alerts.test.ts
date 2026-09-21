import { createRoot, createSignal } from 'solid-js';
import { describe, expect, it, vi } from 'vitest';
import type { ReminderAlert } from '../core/reminder-alert';
import { createReminderAlerts } from './create-reminder-alerts';

const first: ReminderAlert = {
  key: 'r@today',
  reminderId: 'r',
  description: 'Follow up',
};
const tomorrow: ReminderAlert = { ...first, key: 'r@tomorrow' };

function mount(initial: ReminderAlert[] = [], focused = true) {
  return createRoot((dispose) => {
    const [items, setItems] = createSignal(initial);
    const [active, setActive] = createSignal(focused);
    const [acknowledged, setAcknowledged] = createSignal<string[]>([]);
    const acknowledge = vi.fn((keys: string[]) =>
      setAcknowledged((previous) => [...previous, ...keys])
    );
    const hide = vi.fn();
    const show = vi.fn((_items, _acknowledge) => hide);
    createReminderAlerts({
      items,
      active,
      acknowledgedKeys: acknowledged,
      acknowledge,
      show,
    });
    return {
      dispose,
      setItems,
      setActive,
      setAcknowledged,
      acknowledge,
      hide,
      show,
    };
  });
}

describe('foreground reminder alerts', () => {
  it('catches up when focused and does not acknowledge reminders on blur', () => {
    const h = mount([first], false);
    expect(h.show).not.toHaveBeenCalled();
    h.setActive(true);
    expect(h.show).toHaveBeenCalledTimes(1);
    h.setActive(false);
    expect(h.hide).toHaveBeenCalledTimes(1);
    expect(h.acknowledge).not.toHaveBeenCalled();
    h.setActive(true);
    expect(h.show).toHaveBeenCalledTimes(2);
    h.dispose();
  });

  it('updates one grouped alert as a burst arrives and keeps it until acknowledged', () => {
    const h = mount();
    h.setItems([first]);
    const [visible, close] = h.show.mock.calls[0];
    h.setItems([first, tomorrow]);
    expect(h.show).toHaveBeenCalledTimes(1);
    expect(visible()).toEqual([first, tomorrow]);
    close();
    expect(h.acknowledge).toHaveBeenCalledWith([first.key, tomorrow.key]);
    h.setItems([{ ...first }, { ...tomorrow }]);
    expect(h.show).toHaveBeenCalledTimes(1);
    h.dispose();
  });

  it('remembers a dismissal through refetches but alerts for the next occurrence', () => {
    const h = mount([first]);
    h.show.mock.calls[0][1]();
    h.setItems([]);
    h.setItems([{ ...first }]);
    expect(h.show).toHaveBeenCalledTimes(1);
    h.setItems([first, tomorrow]);
    expect(h.show).toHaveBeenCalledTimes(2);
    expect(h.show.mock.calls[1][0]()).toEqual([tomorrow]);
    h.dispose();
  });

  it('acknowledges only the occurrences present when a close gesture starts', () => {
    const h = mount([first]);
    const [closingItems, close] = h.show.mock.calls[0];
    close();
    expect(closingItems()).toEqual([first]);
    h.setItems([first, tomorrow]);
    expect(closingItems()).toEqual([first]);
    expect(h.acknowledge).toHaveBeenCalledWith([first.key]);
    expect(h.show).toHaveBeenCalledTimes(2);
    expect(h.show.mock.calls[1][0]()).toEqual([tomorrow]);
    close();
    expect(h.acknowledge).toHaveBeenCalledTimes(1);
    h.dispose();
  });

  it('retracts a completed or externally acknowledged occurrence', () => {
    const h = mount([first]);
    const closingItems = h.show.mock.calls[0][0];
    h.setAcknowledged([first.key]);
    expect(h.hide).toHaveBeenCalledTimes(1);
    expect(closingItems()).toEqual([first]);
    h.setItems([tomorrow]);
    expect(h.show).toHaveBeenCalledTimes(2);
    h.setItems([]);
    expect(h.hide).toHaveBeenCalledTimes(2);
    expect(h.acknowledge).not.toHaveBeenCalled();
    h.dispose();
  });

  it('does not acknowledge a replacement when an old toast finishes unmounting', () => {
    const h = mount([first]);
    const oldUnmount = h.show.mock.calls[0][1];
    h.setActive(false);
    h.setItems([tomorrow]);
    h.setActive(true);
    oldUnmount();
    expect(h.acknowledge).not.toHaveBeenCalled();
    expect(h.show.mock.calls[1][0]()).toEqual([tomorrow]);
    h.dispose();
    h.show.mock.calls[1][1]();
    expect(h.acknowledge).not.toHaveBeenCalled();
  });
});
