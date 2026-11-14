import { describe, expect, it } from 'vitest';
import { accountsView, type SlackAccount } from './account';
import { type SlackConversation, workspaceCatalogues } from './conversation';
import {
  initiallyPicked,
  normalizeEmailCode,
  normalizeTwoFactorCode,
  parsePastedSession,
} from './login';

const ACME: SlackAccount = {
  id: 'account-acme',
  teamId: 'T0ACME',
  teamName: 'Acme',
  teamDomain: 'acme.slack.com',
  teamIconUrl: undefined,
  enterprise: false,
  displayName: 'Maya',
  state: 'connected',
  endedReason: undefined,
  generation: 1,
};

const conversation: SlackConversation = {
  remoteId: 'C0SHARED',
  kind: 'group',
  name: '#shared-launch',
  isPrivate: false,
  isArchived: false,
  frozen: false,
  orgs: [{ teamId: 'T0GLOBEX', name: 'Globex' }],
  accountIds: ['account-acme'],
  lastActivityAt: '2026-11-10T10:00:00Z',
  inMacro: undefined,
  canAdd: true,
  cannotAddReason: undefined,
};

describe('workspaceCatalogues', () => {
  it('lists a conversation once, under the first live workspace that sees it', () => {
    const initech: SlackAccount = {
      ...ACME,
      id: 'account-initech',
      teamName: 'Initech',
    };
    const shared = {
      ...conversation,
      accountIds: ['account-ended', 'account-initech', 'account-acme'],
    };
    const direct = {
      ...conversation,
      remoteId: 'D0DANA',
      kind: 'direct' as const,
      name: 'Dana Kim',
    };
    const archived = {
      ...conversation,
      remoteId: 'C0OLD',
      canAdd: false,
      cannotAddReason: 'archived' as const,
    };
    expect(
      workspaceCatalogues([ACME, initech], [shared, direct, archived])
    ).toEqual([
      {
        account: ACME,
        channels: [],
        direct: [direct],
        unsupported: [archived],
      },
      { account: initech, channels: [shared], direct: [], unsupported: [] },
    ]);
  });

  it('keeps matches of the other organization’s name while searching', () => {
    expect(
      workspaceCatalogues([ACME], [conversation], 'glob')[0]?.channels
    ).toEqual([conversation]);
    expect(
      workspaceCatalogues([ACME], [conversation], 'initech')[0]?.channels
    ).toEqual([]);
  });
});

describe('accountsView', () => {
  it('lists connecting workspaces as live and drops disconnected ones', () => {
    const connecting = { ...ACME, id: 'a', state: 'connecting' as const };
    const ended = { ...ACME, id: 'b', state: 'logged_out' as const };
    const gone = { ...ACME, id: 'c', state: 'disconnected' as const };
    expect(accountsView([connecting, ended, gone])).toEqual({
      live: [connecting],
      ended: [ended],
    });
  });
});

describe('sign-in input', () => {
  it('reads a pasted session', () => {
    expect(
      parsePastedSession({
        tokens: 'xoxc-111-222\nxoxc-333-444\nxoxc-111-222',
        cookie: 'd=xoxd-abc%2Fdef;',
        cookieDs: '',
      })
    ).toEqual({
      ok: true,
      session: {
        cookie: 'xoxd-abc%2Fdef',
        cookieDs: undefined,
        tokens: [{ token: 'xoxc-111-222' }, { token: 'xoxc-333-444' }],
      },
    });
    expect(
      parsePastedSession({ tokens: 'xoxb-1', cookie: 'xoxd-a', cookieDs: '' })
    ).toEqual({ ok: false, problem: 'bad-token' });
    expect(
      parsePastedSession({ tokens: 'xoxc-1', cookie: 'abc', cookieDs: '' })
    ).toEqual({ ok: false, problem: 'bad-cookie' });
    expect(
      parsePastedSession({ tokens: ' ', cookie: 'xoxd-a', cookieDs: '' })
    ).toEqual({ ok: false, problem: 'no-token' });
  });

  it('normalizes codes', () => {
    expect(normalizeEmailCode(' abc-123 ')).toBe('ABC-123');
    expect(normalizeEmailCode('abc123')).toBe('ABC123');
    expect(normalizeEmailCode('abc-12')).toBeUndefined();
    expect(normalizeTwoFactorCode('123 456')).toBe('123456');
    expect(normalizeTwoFactorCode('12345a')).toBeUndefined();
  });

  it('starts the picker with the workspaces not yet connected', () => {
    const workspace = {
      teamId: 'T1',
      name: 'Acme',
      domain: 'acme.slack.com',
      iconUrl: null,
      enterpriseName: null,
      signIn: 'ready' as const,
      alreadyConnected: false,
    };
    expect(
      initiallyPicked([
        workspace,
        { ...workspace, teamId: 'T2', alreadyConnected: true },
      ])
    ).toEqual(['T1']);
  });
});
