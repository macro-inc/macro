import { describe, expect, it } from 'vitest';
import {
  agentConnectTarget,
  hasLinkGuards,
  isExpired,
  isSameAccount,
} from './agent-connect';

describe('agentConnectTarget', () => {
  it('connects Gmail as the inbox, not a connector', () => {
    expect(agentConnectTarget('gmail')).toEqual({
      kind: 'inbox',
      app: 'gmail',
      name: 'Gmail',
    });
  });

  it('maps Slack to its Pipedream connect slug', () => {
    expect(agentConnectTarget('slack')).toMatchObject({
      kind: 'connector',
      name: 'Slack',
      connectSlug: 'slack_v2',
    });
  });

  it('names known and unknown apps for people', () => {
    expect(agentConnectTarget('notion')).toMatchObject({ name: 'Notion' });
    expect(agentConnectTarget('slack_v2')).toMatchObject({
      name: 'Slack',
      connectSlug: 'slack_v2',
    });
    expect(agentConnectTarget('salesforce_rest_api')).toMatchObject({
      name: 'Salesforce',
      connectSlug: 'salesforce_rest_api',
    });
    expect(agentConnectTarget('microsoft_onedrive')).toMatchObject({
      name: 'OneDrive',
    });
    expect(agentConnectTarget('google_docs')).toMatchObject({
      name: 'Google Docs',
      connectSlug: 'google_docs',
    });
  });

  it('refuses malformed apps', () => {
    expect(agentConnectTarget(undefined)).toBeUndefined();
    expect(agentConnectTarget('')).toBeUndefined();
    expect(agentConnectTarget('../settings')).toBeUndefined();
  });
});

describe('isExpired', () => {
  const now = Date.UTC(2026, 9, 14, 12);

  it('is expired once the timestamp has passed', () => {
    expect(isExpired(String(now / 1000 - 1), now)).toBe(true);
    expect(isExpired(String(now / 1000 + 60), now)).toBe(false);
  });

  it('treats missing or garbled expiry as expired', () => {
    expect(isExpired(undefined, now)).toBe(true);
    expect(isExpired('soon', now)).toBe(true);
  });
});

describe('isSameAccount', () => {
  it('matches emails case-insensitively', () => {
    expect(
      isSameAccount('Founder@Startup.example', 'founder@startup.example')
    ).toBe(true);
  });

  it('flags a different signed-in account', () => {
    expect(
      isSameAccount('founder@startup.example', 'other@startup.example')
    ).toBe(false);
    expect(isSameAccount('founder@startup.example', undefined)).toBe(false);
  });

  it('matches no one when the link names no account', () => {
    expect(isSameAccount(undefined, 'anyone@example.com')).toBe(false);
  });
});

describe('hasLinkGuards', () => {
  it('requires both the account and a numeric expiry', () => {
    expect(hasLinkGuards('founder@startup.example', '1792183192')).toBe(true);
    expect(hasLinkGuards(undefined, '1792183192')).toBe(false);
    expect(hasLinkGuards(' ', '1792183192')).toBe(false);
    expect(hasLinkGuards('founder@startup.example', undefined)).toBe(false);
    expect(hasLinkGuards('founder@startup.example', 'soon')).toBe(false);
  });
});
