import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  consumeInboxLinkReturn,
  rememberInboxLinkReturn,
} from './return-layout';

const LINK_ID = 'link-1';

beforeEach(() => {
  sessionStorage.clear();
  vi.restoreAllMocks();
});

describe('inbox link return layout', () => {
  it('round-trips the layout URL for the link that stashed it', () => {
    rememberInboxLinkReturn(LINK_ID, {
      url: '/calendar/view/component/documents?preview=0#sel',
    });

    expect(consumeInboxLinkReturn(LINK_ID)).toEqual({
      url: '/calendar/view/component/documents?preview=0#sel',
      settingsReturnTo: undefined,
    });
  });

  it('round-trips the settings return layout alongside it', () => {
    rememberInboxLinkReturn(LINK_ID, {
      url: '/settings/connections',
      settingsReturnTo: '/component/inbox/md/doc-1',
    });

    expect(consumeInboxLinkReturn(LINK_ID)).toEqual({
      url: '/settings/connections',
      settingsReturnTo: '/component/inbox/md/doc-1',
    });
  });

  it('clears the stash so a second read finds nothing', () => {
    rememberInboxLinkReturn(LINK_ID, { url: '/component/inbox' });

    consumeInboxLinkReturn(LINK_ID);

    expect(consumeInboxLinkReturn(LINK_ID)).toBeUndefined();
  });

  it('ignores a stash left behind by a different flow', () => {
    rememberInboxLinkReturn('abandoned-link', { url: '/component/inbox' });

    expect(consumeInboxLinkReturn(LINK_ID)).toBeUndefined();
  });

  it('drops a mismatched stash rather than leaving it to match later', () => {
    rememberInboxLinkReturn('abandoned-link', { url: '/component/inbox' });

    consumeInboxLinkReturn(LINK_ID);

    expect(consumeInboxLinkReturn('abandoned-link')).toBeUndefined();
  });

  it('returns undefined for corrupt stored data', () => {
    sessionStorage.setItem('macro:inbox-link:return-layout', 'not json');

    expect(consumeInboxLinkReturn(LINK_ID)).toBeUndefined();
  });

  it('keeps the flow alive when storage is unavailable', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('storage blocked');
    });

    expect(() =>
      rememberInboxLinkReturn(LINK_ID, { url: '/component/inbox' })
    ).not.toThrow();
  });

  it('returns undefined when reading storage throws', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('storage blocked');
    });

    expect(consumeInboxLinkReturn(LINK_ID)).toBeUndefined();
  });
});
