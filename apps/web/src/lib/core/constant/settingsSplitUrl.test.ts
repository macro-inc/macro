import { DEFAULT_ROUTE } from '@app/constants/defaultRoute';
import { describe, expect, it, vi } from 'vitest';
import {
  appendSettingsSplitToUrl,
  stripSettingsSplitFromUrl,
} from './settingsSplitUrl';

// Legacy split decoding only needs alias resolution to exist.
vi.mock('@core/constant/allBlocks', () => ({
  isBlockAlias: vi.fn(() => false),
  resolveBlockAlias: vi.fn((type: string) => type),
}));

describe('stripSettingsSplitFromUrl', () => {
  it('canonicalizes an old flat URL without a settings split', () => {
    expect(
      stripSettingsSplitFromUrl('/component/mail/email/e-1?preview=0#sel')
    ).toBe('/component/mail/~/email/e-1#sel');
  });

  it('strips a trailing settings split, preserving query and hash', () => {
    expect(
      stripSettingsSplitFromUrl(
        '/component/mail/email/e-1/settings/account?preview=0#sel'
      )
    ).toBe('/component/mail/~/email/e-1#sel');
  });

  it('drops the retired Preview Pair query state', () => {
    expect(
      stripSettingsSplitFromUrl(
        '/settings/account/component/mail/md/doc-1?preview=1'
      )
    ).toBe('/component/mail/~/md/doc-1');
  });

  it('drops Preview Pair state from a remaining split', () => {
    expect(
      stripSettingsSplitFromUrl('/component/mail/settings/account?preview=0')
    ).toBe('/component/mail');
  });

  it('drops unowned query params', () => {
    expect(
      stripSettingsSplitFromUrl(
        '/settings/account/component/mail/md/doc-1?keep=value&preview=1'
      )
    ).toBe('/component/mail/~/md/doc-1');
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

  it('strips settings and remaps namespaced state in a framed layout', () => {
    expect(
      stripSettingsSplitFromUrl(
        '/drive/folder/f-1/~/settings/account/~/component/mail?s0.drive.sort=created_at&s1.settings.tab=account&s2.mail.filter=unread'
      )
    ).toBe(
      '/drive/folder/f-1/~/component/mail?s0.drive.sort=created_at&s1.mail.filter=unread'
    );
  });
});

describe('appendSettingsSplitToUrl', () => {
  it('appends the settings split before the query and hash', () => {
    expect(
      appendSettingsSplitToUrl(
        '/component/mail/email/e-1?preview=0#sel',
        'account'
      )
    ).toBe('/component/mail/~/email/e-1/~/settings/account#sel');
  });

  it('handles a trailing slash on the base path', () => {
    expect(appendSettingsSplitToUrl('/component/inbox/', 'account')).toBe(
      '/component/inbox/~/settings/account'
    );
  });
});
