/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const failure = vi.hoisted(() => vi.fn());
vi.mock('@core/component/Toast/Toast', () => ({ toast: { failure } }));
vi.mock('@app/lib/i18n', () => ({ t: (key: string) => key }));

import { makeInputValuePersistenceKey } from '../utils/persistence';
import {
  keepUnsentPostText,
  registerDraftComposer,
} from '../utils/unsent-text';

const CHANNEL = 'channel-1';
const key = makeInputValuePersistenceKey({ channelId: CHANNEL });
const stored = () => JSON.parse(localStorage.getItem(key) ?? 'null');

function composer(initial: string) {
  let value = initial;
  return {
    value: () => value,
    restoreText: (text: string) => {
      value = text;
    },
  };
}

beforeEach(() => {
  localStorage.clear();
  failure.mockClear();
});

describe('the text of a refused channel post', () => {
  it('becomes the stored draft when no composer is open', () => {
    keepUnsentPostText({ channelId: CHANNEL, content: 'typed on friday' });

    expect(stored()).toBe('typed on friday');
    // The channel may be one the person can no longer open.
    expect(failure).toHaveBeenCalledOnce();
  });

  it('follows a stored draft after a blank line, once', () => {
    localStorage.setItem(key, JSON.stringify('a newer draft'));
    keepUnsentPostText({ channelId: CHANNEL, content: 'typed on friday' });
    keepUnsentPostText({ channelId: CHANNEL, content: 'typed on friday' });

    expect(stored()).toBe('a newer draft\n\ntyped on friday');
  });

  it('goes into an open composer that is empty', () => {
    const open = composer('');
    const close = registerDraftComposer(key, open);
    keepUnsentPostText({ channelId: CHANNEL, content: 'typed on friday' });
    close();

    expect(open.value()).toBe('typed on friday');
    expect(failure).not.toHaveBeenCalled();
  });

  it('is left alone where the composer already took it back', () => {
    const open = composer('typed on friday');
    const close = registerDraftComposer(key, open);
    keepUnsentPostText({ channelId: CHANNEL, content: 'typed on friday' });
    close();

    expect(open.value()).toBe('typed on friday');
    expect(failure).not.toHaveBeenCalled();
  });

  it('is offered for copying when the open composer holds a newer draft', () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    const open = composer('something else');
    const close = registerDraftComposer(key, open);
    keepUnsentPostText({ channelId: CHANNEL, content: 'typed on friday' });
    close();

    expect(open.value()).toBe('something else');
    expect(failure).toHaveBeenCalledTimes(1);
    failure.mock.calls[0][1].actions[0].onClick();
    expect(writeText).toHaveBeenCalledWith('typed on friday');
  });

  it('of a thread reply goes to the thread composer when open, else the channel draft', () => {
    const threadKey = makeInputValuePersistenceKey({
      channelId: `channel:${CHANNEL}`,
      threadId: 'thread-1',
    });
    const thread = composer('');
    const close = registerDraftComposer(threadKey, thread);
    keepUnsentPostText({
      channelId: CHANNEL,
      threadId: 'thread-1',
      content: 'a reply',
    });
    close();
    expect(thread.value()).toBe('a reply');

    keepUnsentPostText({
      channelId: CHANNEL,
      threadId: 'thread-1',
      content: 'another reply',
    });
    expect(stored()).toBe('another reply');
  });
  it('does not take a short post for part of a newer draft', () => {
    const open = composer('look at this');
    const close = registerDraftComposer(key, open);
    keepUnsentPostText({ channelId: CHANNEL, content: 'ok' });
    close();

    expect(open.value()).toBe('look at this');
    expect(failure).toHaveBeenCalledOnce();
  });

  it('hands two posts refused together to the composer and to a copy', () => {
    // The composer's own value lags the text it was handed.
    const restoreText = vi.fn();
    const close = registerDraftComposer(key, { value: () => '', restoreText });
    keepUnsentPostText({ channelId: CHANNEL, content: 'first' });
    keepUnsentPostText({ channelId: CHANNEL, content: 'second' });
    close();

    expect(restoreText.mock.calls).toEqual([['first']]);
    expect(failure).toHaveBeenCalledOnce();
  });

  it('uses the empty one of two composers on the same channel', () => {
    const busy = composer('a newer draft');
    const empty = composer('');
    const closeBusy = registerDraftComposer(key, busy);
    const closeEmpty = registerDraftComposer(key, empty);
    keepUnsentPostText({ channelId: CHANNEL, content: 'typed on friday' });
    closeEmpty();
    // The first stays registered after the second leaves.
    keepUnsentPostText({ channelId: CHANNEL, content: 'another' });
    closeBusy();

    expect(empty.value()).toBe('typed on friday');
    expect(busy.value()).toBe('a newer draft');
    expect(failure).toHaveBeenCalledOnce();
  });
});
