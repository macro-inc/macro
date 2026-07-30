import { DEFAULT_ROUTE } from '@app/constants/defaultRoute';
import { describe, expect, it, vi } from 'vitest';
import {
  appendSettingsSplitToUrl,
  stripSettingsSplitFromUrl,
} from './settingsSplitUrl';

// The preview-persistence import chain reaches the block registry, whose
// eager definition glob drags in every block feature; the URL helpers only
// need alias resolution to exist.
vi.mock('@core/constant/allBlocks', () => ({
  isBlockAlias: vi.fn(() => false),
  resolveBlockAlias: vi.fn((type: string) => type),
}));

describe('stripSettingsSplitFromUrl', () => {
  it('returns a URL without a settings split unchanged', () => {
    expect(
      stripSettingsSplitFromUrl('/component/mail/email/e-1?preview=0#sel')
    ).toBe('/component/mail/email/e-1?preview=0#sel');
  });

  it('strips a trailing settings split, preserving query and hash', () => {
    expect(
      stripSettingsSplitFromUrl(
        '/component/mail/email/e-1/settings/account?preview=0#sel'
      )
    ).toBe('/component/mail/email/e-1?preview=0#sel');
  });

  it('remaps Preview Pair indices past a stripped settings split', () => {
    expect(
      stripSettingsSplitFromUrl(
        '/settings/account/component/mail/md/doc-1?preview=1'
      )
    ).toBe('/component/mail/md/doc-1?preview=0');
  });

  it('drops a Preview Pair that referenced the settings split', () => {
    expect(
      stripSettingsSplitFromUrl('/component/mail/settings/account?preview=0')
    ).toBe('/component/mail');
  });

  it('keeps unrelated query params while remapping the preview param', () => {
    expect(
      stripSettingsSplitFromUrl(
        '/settings/account/component/mail/md/doc-1?keep=value&preview=1'
      )
    ).toBe('/component/mail/md/doc-1?keep=value&preview=0');
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
});

describe('appendSettingsSplitToUrl', () => {
  it('appends the settings split before the query and hash', () => {
    expect(
      appendSettingsSplitToUrl(
        '/component/mail/email/e-1?preview=0#sel',
        'account'
      )
    ).toBe('/component/mail/email/e-1/settings/account?preview=0#sel');
  });

  it('handles a trailing slash on the base path', () => {
    expect(appendSettingsSplitToUrl('/component/inbox/', 'account')).toBe(
      '/component/inbox/settings/account'
    );
  });
});
