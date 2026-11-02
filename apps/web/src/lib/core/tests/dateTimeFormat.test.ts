import { afterEach, expect, it, vi } from 'vitest';
import { dateTimeFormatter } from '../util/dateTimeFormat';

afterEach(() => vi.unstubAllEnvs());

it('reuses formatters per current system zone across a timezone round trip', () => {
  const date = new Date('2025-06-14T14:15:00Z');
  const options = { hour: 'numeric', minute: '2-digit', hour12: true } as const;
  vi.stubEnv('TZ', 'UTC');
  const utc = dateTimeFormatter('en-US', options);
  expect(utc.format(date)).toBe('2:15 PM');
  expect(dateTimeFormatter('en-US', options)).toBe(utc);

  vi.stubEnv('TZ', 'America/New_York');
  const local = dateTimeFormatter('en-US', options);
  expect(local.format(date)).toBe('10:15 AM');
  expect(local).not.toBe(utc);
  expect(dateTimeFormatter('en-US', options)).toBe(local);

  vi.stubEnv('TZ', 'UTC');
  expect(dateTimeFormatter('en-US', options)).toBe(utc);
});

it('keeps explicit-zone formatters independent of system timezone changes', () => {
  vi.stubEnv('TZ', 'UTC');
  const options = {
    timeZone: 'America/New_York',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  } as const;
  const explicit = dateTimeFormatter('en-US', options);
  vi.stubEnv('TZ', 'Europe/London');
  expect(dateTimeFormatter('en-US', options)).toBe(explicit);
  expect(explicit.format(new Date('2025-06-14T14:15:00Z'))).toBe('10:15 AM');
});
