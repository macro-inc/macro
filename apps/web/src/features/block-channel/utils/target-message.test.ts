import { URL_PARAMS } from '@block-channel/constants';
import { describe, expect, it } from 'vitest';
import { convertTargetMessage } from './target-message';

describe('convertTargetMessage', () => {
  it('treats a bare message id as a top-level message', () => {
    expect(convertTargetMessage({ [URL_PARAMS.message]: 'msg-1' })).toEqual({
      targetMessageId: 'msg-1',
      targetMessageReplyId: undefined,
    });
  });

  it('treats message-within-thread as a reply', () => {
    expect(
      convertTargetMessage({
        [URL_PARAMS.message]: 'reply-1',
        [URL_PARAMS.thread]: 'root-1',
      })
    ).toEqual({
      targetMessageId: 'root-1',
      targetMessageReplyId: 'reply-1',
    });
  });

  it('treats a thread root targeting itself (thread === message) as top-level, not a reply', () => {
    // A thread row falls back to its own ids, where messageId === threadId.
    // That must resolve to the root as a top-level message so it highlights,
    // rather than a reply-within-itself that matches nothing.
    expect(
      convertTargetMessage({
        [URL_PARAMS.message]: 'root-1',
        [URL_PARAMS.thread]: 'root-1',
      })
    ).toEqual({
      targetMessageId: 'root-1',
      targetMessageReplyId: undefined,
    });
  });

  it('returns no target for empty params', () => {
    expect(convertTargetMessage({})).toEqual({
      targetMessageId: undefined,
      targetMessageReplyId: undefined,
    });
  });
});
