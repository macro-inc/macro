import { fireEvent, render } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { describe, expect, it, vi } from 'vitest';
import type { CalendarAgendaEvent } from '../core/calendar-agenda';
import { CalendarAgenda } from './calendar-agenda';

const event: CalendarAgendaEvent = {
  id: 'intro',
  title: 'Customer intro',
  start: '2026-09-18T10:00:00',
  end: '2026-09-18T10:30:00',
  allDay: false,
  color: 'var(--color-accent)',
  calendar: 'Work',
  hasCall: true,
};

describe('calendar agenda selection', () => {
  it('keeps the selected anchor connected when refreshed objects replace the event', () => {
    const [events, setEvents] = createSignal([event]);
    const selected = vi.fn();
    const view = render(() => (
      <CalendarAgenda
        events={events()}
        loading={false}
        use24HourTime={false}
        onSelect={selected}
      />
    ));
    const original = view.getByRole('button', { name: /Customer intro/ });
    fireEvent.click(original);
    expect(selected).toHaveBeenCalledWith('intro', original);
    setEvents([{ ...event, title: 'Updated intro' }]);
    expect(view.getByRole('button', { name: /Updated intro/ })).toBe(original);
    expect(original.isConnected).toBe(true);
  });

  it('shows the date span and groups an ongoing event under the visible day', () => {
    const view = render(() => (
      <CalendarAgenda
        events={[
          {
            ...event,
            title: 'Offsite',
            start: '2026-09-17',
            end: '2026-09-20',
            allDay: true,
          },
        ]}
        rangeStart={new Date('2026-09-18T00:00:00')}
        loading={false}
        use24HourTime={false}
        onSelect={() => {}}
      />
    ));
    expect(view.getByRole('heading').textContent).toBe('Friday, September 18');
    const row = view.getByRole('button', { name: /Offsite/ });
    expect(row.textContent).toContain('Sep 17');
    expect(row.textContent).toContain('Sep 19');
  });
});
