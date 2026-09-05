import { render, screen } from '@solidjs/testing-library';
import { describe, expect, it, vi } from 'vitest';
import type { CalendarEventEntity } from '../../types/entity';
import { CalendarEventWhen } from './calendar';

vi.mock('@core/user', () => ({
  emailToMacroId: (email: string) =>
    email.includes('@') ? `macro|${email}` : undefined,
  getDisplayName: (id: string) =>
    id === 'macro|jacob@macro.com'
      ? 'Jacob Beckerman'
      : id.replace(/^macro\|/, ''),
}));
vi.mock('@core/component/UserIcon', () => ({ UserIcon: () => null }));
vi.mock('../../entity', () => ({ Entity: {} }));

function event(
  organizer: CalendarEventEntity['organizer']
): CalendarEventEntity {
  return {
    id: 'event',
    name: 'Out of office',
    ownerId: 'macro|gab@macro.com',
    type: 'calendar_event',
    status: 'confirmed',
    isReadOnly: false,
    organizer,
    time: {
      kind: 'timed',
      startsAt: '2026-08-14T04:00:00Z',
      endsAt: '2026-08-15T04:00:00Z',
    },
  };
}

describe('CalendarEventWhen organizer', () => {
  it('names a shared calendar by the name the source supplied, not its address', () => {
    render(() => (
      <CalendarEventWhen
        entity={event({
          name: 'Macro Vacation',
          email: 'c_03728f99@group.calendar.google.com',
        })}
      />
    ));

    expect(screen.getByText('Macro Vacation')).toBeTruthy();
    expect(screen.queryByText(/group\.calendar\.google\.com/)).toBeNull();
  });

  it('prefers the Macro profile name when the organizer has one', () => {
    render(() => (
      <CalendarEventWhen
        entity={event({ name: 'jacob', email: 'jacob@macro.com' })}
      />
    ));

    expect(screen.getByText('Jacob Beckerman')).toBeTruthy();
  });

  it('falls back to the email when the organizer has neither a profile nor a name', () => {
    render(() => (
      <CalendarEventWhen entity={event({ email: 'someone@example.com' })} />
    ));

    expect(screen.getByText('someone@example.com')).toBeTruthy();
  });
});
