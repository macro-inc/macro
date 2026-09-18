import type {
  Booking,
  BookingAttendance,
  BookingReceipt,
  BookingRequest,
  PublicProfile,
  SchedulingProfile,
} from '@app/features/scheduling/core/types';
import { SERVER_HOSTS } from '@core/constant/servers';
import { fetchWithToken } from '@core/util/fetchWithToken';
import { safeFetch } from '@core/util/safeFetch';

const host = `${SERVER_HOSTS['email-service']}/calendar/scheduling`;
const scope = (teamId?: string) =>
  teamId ? `?teamId=${encodeURIComponent(teamId)}` : '';
const json = (body: unknown) => ({
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

export const schedulingClient = {
  settings: (teamId?: string) =>
    fetchWithToken<{ profile: SchedulingProfile }>(
      `${host}/settings${scope(teamId)}`
    ),
  save: (profile: SchedulingProfile, teamId?: string) =>
    fetchWithToken<{ profile: SchedulingProfile }>(
      `${host}/settings${scope(teamId)}`,
      { method: 'PUT', ...json(profile) }
    ),
  bookings: (teamId?: string, range?: { from: string; to: string }) => {
    const query = new URLSearchParams();
    if (teamId) query.set('teamId', teamId);
    if (range) {
      query.set('from', range.from);
      query.set('to', range.to);
    }
    return fetchWithToken<{ bookings: Booking[] }>(`${host}/bookings?${query}`);
  },
  setAttendance: (id: string, attendance: BookingAttendance) =>
    fetchWithToken<{ booking: Booking }>(
      `${host}/bookings/${encodeURIComponent(id)}/attendance`,
      { method: 'POST', ...json({ attendance }) }
    ),
  manage: (id: string) =>
    fetchWithToken<BookingReceipt>(
      `${host}/bookings/${encodeURIComponent(id)}/manage`
    ),
  approve: (id: string) =>
    fetchWithToken<{ booking: Booking }>(
      `${host}/bookings/${encodeURIComponent(id)}/approve`,
      { method: 'POST' }
    ),
  cancel: (id: string) =>
    fetchWithToken<{ booking: Booking }>(
      `${host}/bookings/${encodeURIComponent(id)}/cancel`,
      { method: 'POST' }
    ),
  profile: (id: string) =>
    safeFetch<{ profile: PublicProfile }>(
      `${host}/public/${encodeURIComponent(id)}`
    ),
  slots: (profileId: string, eventId: string, date: string, timeZone: string) =>
    safeFetch<{ slots: { startsAt: string; endsAt: string }[] }>(
      `${host}/public/${encodeURIComponent(profileId)}/${encodeURIComponent(eventId)}/slots?date=${encodeURIComponent(date)}&timeZone=${encodeURIComponent(timeZone)}`
    ),
  book: (profileId: string, eventId: string, request: BookingRequest) =>
    safeFetch<BookingReceipt>(
      `${host}/public/${encodeURIComponent(profileId)}/${encodeURIComponent(eventId)}/book`,
      { method: 'POST', ...json(request) }
    ),
  receipt: (id: string, token: string) =>
    safeFetch<BookingReceipt>(
      `${host}/public/bookings/${encodeURIComponent(id)}`,
      { headers: { Authorization: `Bearer ${token}` } }
    ),
  replacementSlots: (id: string, token: string, date: string) =>
    safeFetch<{ slots: { startsAt: string; endsAt: string }[] }>(
      `${host}/public/bookings/${encodeURIComponent(id)}/slots?date=${encodeURIComponent(date)}`,
      { headers: { Authorization: `Bearer ${token}` } }
    ),
  reschedule: (id: string, token: string, startsAt: string) =>
    safeFetch<BookingReceipt>(
      `${host}/public/bookings/${encodeURIComponent(id)}/reschedule`,
      { method: 'POST', ...json({ token, startsAt }) }
    ),
  cancelPublic: (id: string, token: string) =>
    safeFetch<{ booking: Booking }>(
      `${host}/public/bookings/${encodeURIComponent(id)}/cancel`,
      { method: 'POST', ...json({ token }) }
    ),
};
