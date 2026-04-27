import { commsServiceClient } from '@service-comms/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  channelAttachmentsQueryOptions,
  getChannelAttachmentsQueryKey,
  getChannelAttachmentsQueryKeyPrefix,
} from '../channel-attachments';

vi.mock('@service-comms/client', () => ({
  commsServiceClient: {
    getChannelAttachments: vi.fn(),
  },
}));

describe('channel attachment queries', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('keys media and document attachment queries separately', () => {
    expect(getChannelAttachmentsQueryKey('channel-1', 'static')).toEqual([
      ...getChannelAttachmentsQueryKeyPrefix('channel-1'),
      { attachmentType: 'static' },
    ]);
    expect(getChannelAttachmentsQueryKey('channel-1', 'dss')).toEqual([
      ...getChannelAttachmentsQueryKeyPrefix('channel-1'),
      { attachmentType: 'dss' },
    ]);
    expect(getChannelAttachmentsQueryKey('channel-1', 'static')).not.toEqual(
      getChannelAttachmentsQueryKey('channel-1', 'dss')
    );
  });

  it('passes attachment type, cursor, and abort signal to the service client', async () => {
    const page = { items: [], next_cursor: null };
    vi.mocked(commsServiceClient.getChannelAttachments).mockResolvedValue([
      null,
      page,
    ]);
    const signal = new AbortController().signal;

    await expect(
      channelAttachmentsQueryOptions('channel-1', 'static').queryFn({
        pageParam: 'cursor-1',
        signal,
      })
    ).resolves.toBe(page);

    expect(commsServiceClient.getChannelAttachments).toHaveBeenCalledWith({
      channel_id: 'channel-1',
      limit: 100,
      cursor: 'cursor-1',
      attachment_type: 'static',
      signal,
    });
  });
});
