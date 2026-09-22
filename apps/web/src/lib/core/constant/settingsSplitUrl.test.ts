import { DEFAULT_ROUTE } from '@app/constants/defaultRoute';
import { describe, expect, it } from 'vitest';
import {
  appendSettingsSplitToUrl,
  stripSettingsSplitFromUrl,
} from './settingsSplitUrl';

describe('stripSettingsSplitFromUrl', () => {
  it('returns a URL without a settings split unchanged', () => {
    expect(
      stripSettingsSplitFromUrl('/component/mail/email/e-1?filter=all#sel')
    ).toBe('/component/mail/email/e-1?filter=all#sel');
  });

  it('strips a trailing settings split, preserving query and hash', () => {
    expect(
      stripSettingsSplitFromUrl(
        '/component/mail/email/e-1/settings/account?filter=all#sel'
      )
    ).toBe('/component/mail/email/e-1?filter=all#sel');
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
        '/component/mail/email/e-1?filter=all#sel',
        'account'
      )
    ).toBe('/component/mail/email/e-1/settings/account?filter=all#sel');
  });

  it('handles a trailing slash on the base path', () => {
    expect(appendSettingsSplitToUrl('/component/inbox/', 'account')).toBe(
      '/component/inbox/settings/account'
    );
  });
});
