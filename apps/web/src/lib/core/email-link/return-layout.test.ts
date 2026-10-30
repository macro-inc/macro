import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  consumeInboxLinkReturn,
  readInboxLinkReturn,
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
    });
  });

  it('round-trips the permissions the flow asked consent for', () => {
    rememberInboxLinkReturn(LINK_ID, {
      url: '/calendar/week',
      scopes: 'gmail_and_calendar',
    });

    expect(consumeInboxLinkReturn(LINK_ID)).toEqual({
      url: '/calendar/week',
      scopes: 'gmail_and_calendar',
    });
  });

  it('drops permissions it does not recognize', () => {
    sessionStorage.setItem(
      'macro:inbox-link:return-layout',
      JSON.stringify({ linkId: LINK_ID, url: '/home', scopes: 'everything' })
    );

    expect(consumeInboxLinkReturn(LINK_ID)).toEqual({ url: '/home' });
  });

  it('reads without clearing, so the callback can look before it leaves', () => {
    rememberInboxLinkReturn(LINK_ID, { url: '/home', scopes: 'gmail' });

    expect(readInboxLinkReturn(LINK_ID)).toEqual({
      url: '/home',
      scopes: 'gmail',
    });
    expect(readInboxLinkReturn(LINK_ID)).toEqual({
      url: '/home',
      scopes: 'gmail',
    });
    expect(readInboxLinkReturn('other-link')).toBeUndefined();
    expect(consumeInboxLinkReturn(LINK_ID)).toEqual({
      url: '/home',
      scopes: 'gmail',
    });
  });

  it('clears the stash so a second read finds nothing', () => {
    rememberInboxLinkReturn(LINK_ID, { url: '/home' });

    consumeInboxLinkReturn(LINK_ID);

    expect(consumeInboxLinkReturn(LINK_ID)).toBeUndefined();
  });

  it('keeps the stash for a callback that reloads before it leaves', () => {
    const addition = {
      provider: 'GMAIL' as const,
      connectedInboxes: [{ id: 'inbox-1', emailAddress: 'person@example.com' }],
    };
    rememberInboxLinkReturn(LINK_ID, { url: '/mail', addition });

    readInboxLinkReturn(LINK_ID);

    expect(readInboxLinkReturn(LINK_ID)).toEqual({ url: '/mail', addition });
    expect(consumeInboxLinkReturn(LINK_ID)).toEqual({ url: '/mail', addition });
    expect(readInboxLinkReturn(LINK_ID)).toBeUndefined();
  });

  it('ignores a stash left behind by a different flow', () => {
    rememberInboxLinkReturn('abandoned-link', { url: '/home' });

    expect(consumeInboxLinkReturn(LINK_ID)).toBeUndefined();
  });

  it('drops a mismatched stash rather than leaving it to match later', () => {
    rememberInboxLinkReturn('abandoned-link', { url: '/home' });

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
      rememberInboxLinkReturn(LINK_ID, { url: '/home' })
    ).not.toThrow();
  });

  it('returns undefined when reading storage throws', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('storage blocked');
    });

    expect(consumeInboxLinkReturn(LINK_ID)).toBeUndefined();
  });
});
