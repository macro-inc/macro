import { DEFAULT_ROUTE } from '@app/constants/defaultRoute';
import { describe, expect, it, vi } from 'vitest';
import {
  appendSettingsSplitToUrl,
  settingsTabSlugFromUrl,
  stripSettingsSplitFromUrl,
} from './settingsSplitUrl';

// Legacy split decoding only needs alias resolution to exist.
vi.mock('@core/constant/allBlocks', () => ({
  isBlockAlias: vi.fn(() => false),
  resolveBlockAlias: vi.fn((type: string) => type),
}));

describe('settingsTabSlugFromUrl', () => {
  it('reads schema-defaulted settings state from a framed layout', () => {
    expect(settingsTabSlugFromUrl('/drive/folder/f-1/~/settings')).toBe(
      'account'
    );
  });
});

describe('stripSettingsSplitFromUrl', () => {
  it('canonicalizes an old flat URL and drops unowned search', () => {
    expect(
      stripSettingsSplitFromUrl('/component/mail/email/e-1?filter=all#sel')
    ).toBe('/component/mail/~/email/e-1#sel');
  });

  it('strips a trailing settings split, preserving the hash', () => {
    expect(
      stripSettingsSplitFromUrl(
        '/component/mail/email/e-1/settings/account?filter=all#sel'
      )
    ).toBe('/component/mail/~/email/e-1#sel');
  });

  it('strips the legacy component/settings form', () => {
    expect(
      stripSettingsSplitFromUrl('/component/inbox/component/settings')
    ).toBe('/component/inbox');
  });

  it('does not mistake a block id named settings for a settings split', () => {
    expect(stripSettingsSplitFromUrl('/md/settings')).toBe('/md/settings');
  });

  it('falls back to the default route when settings was the only split', () => {
    expect(stripSettingsSplitFromUrl('/settings/account')).toBe(DEFAULT_ROUTE);
  });

  it('remaps owned repeated search state after removing a variable-length pane', () => {
    expect(
      stripSettingsSplitFromUrl(
        '/drive/folder/f-1/~/settings/account/~/component/mail?s0.drive.sort=created_at&s1.settings.tab=account&s2.mail.filter=unread&s2.mail.filter=starred'
      )
    ).toBe(
      '/drive/folder/f-1/~/component/mail?s0.drive.sort=created_at&s1.mail.filter=unread&s1.mail.filter=starred'
    );
  });

  it('accepts an old Agents chat alias and emits its canonical route', () => {
    expect(
      stripSettingsSplitFromUrl('/agent-chats/chat-1/~/settings/account')
    ).toBe('/agents/chat/chat-1');
  });
});

describe('appendSettingsSplitToUrl', () => {
  it('appends the settings split before the query and hash', () => {
    expect(
      appendSettingsSplitToUrl(
        '/component/mail/email/e-1?filter=all#sel',
        'account'
      )
    ).toBe('/component/mail/~/email/e-1/~/settings/account#sel');
  });

  it('handles a trailing slash on the base path', () => {
    expect(appendSettingsSplitToUrl('/component/inbox/', 'account')).toBe(
      '/component/inbox/~/settings/account'
    );
  });

  it('canonicalizes aliases and preserves repeated owned search values', () => {
    expect(
      appendSettingsSplitToUrl(
        '/drive/tab/owned?s0.drive.tag=one&s0.drive.tag=two#sel',
        'billing'
      )
    ).toBe('/drive/~/settings/billing?s0.drive.tag=one&s0.drive.tag=two#sel');
  });
});
