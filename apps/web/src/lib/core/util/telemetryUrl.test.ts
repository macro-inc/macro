import { describe, expect, it } from 'vitest';
import {
  redactCallLinkProperties,
  redactCallLinkTokens,
  telemetryUrl,
} from './telemetryUrl';

describe('meeting URL telemetry', () => {
  it.each([
    [
      'https://gateway.macro.com/dss/call/join/secret',
      'https://gateway.macro.com/dss/call/join/:shareToken',
    ],
    ['/call/join/secret/leave', '/call/join/:shareToken/leave'],
    ['/call/meetings/join/secret', '/call/meetings/join/:shareToken'],
    [
      'https://macro.com/app/meet/secret?join=true',
      'https://macro.com/app/meet/:shareToken',
    ],
    ['/meet/secret#fragment', '/meet/:shareToken'],
  ])('redacts the capability in %s', (input, expected) => {
    expect(telemetryUrl(input)).toBe(expected);
  });

  it('keeps unrelated endpoint paths intact', () => {
    expect(telemetryUrl('/call/record/id/link')).toBe('/call/record/id/link');
    expect(telemetryUrl('/calendar/meetings')).toBe('/calendar/meetings');
  });

  it('redacts tokens included in serialized errors and exception messages', () => {
    const message =
      'Request to https://gateway.macro.com/dss/call/join/secret/leave failed';
    expect(redactCallLinkTokens(message)).not.toContain('secret');
    expect(redactCallLinkTokens(JSON.stringify({ message }))).not.toContain(
      'secret'
    );
  });

  it('redacts retained landing URLs and referrers in person properties', () => {
    const initialProperties = {
      $initial_current_url: 'https://macro.com/app/meet/secret?join=true',
      $initial_pathname: '/app/meet/secret',
      $initial_referrer: 'https://macro.com/app/meet/secret',
      visits: 1,
    };
    const properties = {
      $current_url: 'https://macro.com/app',
      $referrer: 'https://macro.com/app/meet/secret',
      $set: initialProperties,
      $set_once: initialProperties,
    };

    const sanitized = redactCallLinkProperties(properties);

    expect(JSON.stringify(sanitized)).not.toContain('secret');
    expect(sanitized.$set).toEqual({
      $initial_current_url: 'https://macro.com/app/meet/:shareToken?join=true',
      $initial_pathname: '/app/meet/:shareToken',
      $initial_referrer: 'https://macro.com/app/meet/:shareToken',
      visits: 1,
    });
    expect(sanitized.$set_once).toEqual(sanitized.$set);
    expect(sanitized.$current_url).toBe('https://macro.com/app');
    expect(sanitized.$set).not.toBe(initialProperties);
    expect(properties.$set.$initial_pathname).toBe('/app/meet/secret');
    expect(redactCallLinkProperties(initialProperties)).toEqual(sanitized.$set);
  });

  it('preserves unrelated nested event data and non-object updates', () => {
    const details = { count: 3 };
    const properties = { details, $set: null, $set_once: ['unchanged'] };

    expect(redactCallLinkProperties(properties)).toEqual(properties);
    expect(redactCallLinkProperties(properties).details).toBe(details);
  });
});
