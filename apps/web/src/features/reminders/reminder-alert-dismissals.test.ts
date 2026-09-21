import { createRoot, createSignal } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createReminderAlertDismissals } from './reminder-alert-dismissals';

function mount(user = 'alice') {
  return createRoot((dispose) => {
    const [userId, setUserId] = createSignal<string | undefined>(user);
    return { ...createReminderAlertDismissals(userId), setUserId, dispose };
  });
}

describe('reminder alert acknowledgement storage', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => vi.restoreAllMocks());

  it('survives reloads and isolates different accounts', () => {
    const first = mount();
    first.acknowledge(['r@today']);
    first.dispose();
    const next = mount();
    expect(next.keys()).toEqual(['r@today']);
    next.setUserId('bob');
    expect(next.keys()).toEqual([]);
    next.setUserId('alice');
    expect(next.keys()).toEqual(['r@today']);
    next.dispose();
  });

  it('merges closes from another route/tab and reacts to storage events', () => {
    const h = mount();
    localStorage.setItem(
      'macro:reminder-alerts:alice',
      JSON.stringify(['other'])
    );
    h.acknowledge(['local']);
    expect(h.keys()).toEqual(['local', 'other']);
    localStorage.setItem(
      'macro:reminder-alerts:alice',
      JSON.stringify(['other', 'local', 'new'])
    );
    window.dispatchEvent(
      new StorageEvent('storage', {
        key: 'macro:reminder-alerts:alice',
        newValue: JSON.stringify(['other', 'local', 'new']),
        url: 'http://localhost/app/component/reminders',
      })
    );
    expect(h.keys()).toEqual(['local', 'new', 'other']);
    h.dispose();
  });

  it('still acknowledges in memory when storage is unavailable', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('denied');
    });
    const h = mount();
    h.acknowledge(['r@today']);
    expect(h.keys()).toEqual(['r@today']);
    h.dispose();
  });

  it('reconciles a concurrent overwrite without losing either dismissal', () => {
    const h = mount();
    h.acknowledge(['local']);
    localStorage.setItem(
      'macro:reminder-alerts:alice',
      JSON.stringify(['remote'])
    );
    window.dispatchEvent(
      new StorageEvent('storage', {
        key: 'macro:reminder-alerts:alice',
        newValue: JSON.stringify(['remote']),
      })
    );
    expect(h.keys()).toEqual(['local', 'remote']);
    expect(
      JSON.parse(localStorage.getItem('macro:reminder-alerts:alice')!)
    ).toEqual(['local', 'remote']);
    h.dispose();
  });

  it('ignores corrupt and unexpected persisted data', () => {
    localStorage.setItem('macro:reminder-alerts:alice', '{bad');
    const h = mount();
    expect(h.keys()).toEqual([]);
    localStorage.setItem(
      'macro:reminder-alerts:alice',
      JSON.stringify(['valid', 5, null])
    );
    window.dispatchEvent(
      new StorageEvent('storage', { key: 'macro:reminder-alerts:alice' })
    );
    expect(h.keys()).toEqual(['valid']);
    h.dispose();
  });
});
