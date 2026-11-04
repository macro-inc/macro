import { describe, expect, it } from 'vitest';
import {
  redactLinkTokenProperties,
  redactLinkTokens,
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
    ['/call/meetings/invite/secret', '/call/meetings/invite/:shareToken'],
    [
      '/call/meetings/invite/secret/users',
      '/call/meetings/invite/:shareToken/users',
    ],
    [
      'https://macro.com/app/meet/secret?join=true',
      'https://macro.com/app/meet/:shareToken',
    ],
    ['/meet/secret#fragment', '/meet/:shareToken'],
    ['/meet/join/secret', '/meet/join/:shareToken'],
    [
      'https://macro.com/app/meet/join/secret?source=calendar',
      'https://macro.com/app/meet/join/:shareToken',
    ],
  ])('redacts the capability in %s', (input, expected) => {
    expect(telemetryUrl(input)).toBe(expected);
  });

  it.each([
    [
      'https://macro.com/app/team-invite?link=0a1b2c3d-secret',
      'https://macro.com/app/team-invite?link=:inviteToken',
    ],
    [
      '/app/team-invite?utm_source=slack&link=secret#top',
      '/app/team-invite?utm_source=slack&link=:inviteToken#top',
    ],
    ['/app/team-invite?id=invite-id', '/app/team-invite?id=invite-id'],
    [
      'https://macro.com/app/login?redirect=%2Fteam-invite%3Flink%3Dsecret',
      'https://macro.com/app/login?redirect=%2Fteam-invite%3Flink%3D:inviteToken',
    ],
    [
      '/app/login?redirect=%2Fteam-invite%3Fsource%3Dslack%26link%3Dsecret&next=1',
      '/app/login?redirect=%2Fteam-invite%3Fsource%3Dslack%26link%3D:inviteToken&next=1',
    ],
  ])('redacts a team invite link token in %s', (input, expected) => {
    expect(redactLinkTokens(input)).toBe(expected);
  });

  it('redacts team invite link tokens in pageview properties', () => {
    expect(
      redactLinkTokenProperties({
        $current_url: 'https://macro.com/app/team-invite?link=secret',
      })
    ).toEqual({
      $current_url: 'https://macro.com/app/team-invite?link=:inviteToken',
    });
  });

  it('keeps unrelated endpoint paths intact', () => {
    expect(telemetryUrl('/call/record/id/link')).toBe('/call/record/id/link');
    expect(telemetryUrl('/calendar/meetings')).toBe('/calendar/meetings');
    expect(telemetryUrl('/app/meet/new')).toBe('/app/meet/new');
    expect(telemetryUrl('/meet/new?source=sidebar')).toBe('/meet/new');
  });

  it('redacts tokens included in serialized errors and exception messages', () => {
    const message =
      'Request to https://gateway.macro.com/dss/call/join/secret/leave failed';
    expect(redactLinkTokens(message)).not.toContain('secret');
    expect(redactLinkTokens(JSON.stringify({ message }))).not.toContain(
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

    const sanitized = redactLinkTokenProperties(properties);

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
    expect(redactLinkTokenProperties(initialProperties)).toEqual(
      sanitized.$set
    );
  });

  it('redacts setup capabilities in serialized messages and retained person properties', () => {
    const url = 'https://macro.com/app/meet/join/private-token?source=calendar';
    const sanitized = redactLinkTokenProperties({
      $current_url: url,
      $set: { $initial_current_url: url },
      $set_once: { $initial_referrer: url },
    });
    expect(JSON.stringify(sanitized)).not.toContain('private-token');
    expect(sanitized.$current_url).toBe(
      'https://macro.com/app/meet/join/:shareToken?source=calendar'
    );
    expect(
      redactLinkTokens(JSON.stringify({ message: `Failed ${url}` }))
    ).not.toContain('private-token');
  });

  it('preserves unrelated nested event data and non-object updates', () => {
    const details = { count: 3 };
    const properties = { details, $set: null, $set_once: ['unchanged'] };

    expect(redactLinkTokenProperties(properties)).toEqual(properties);
    expect(redactLinkTokenProperties(properties).details).toBe(details);
  });
});
