import { describe, expect, test } from 'bun:test';
// Load the SDK first: documents/document.ts and tasks/task.ts import each other.
import '../../macro';
import type { MacroClient } from '../../utils/client';
import { Document } from '../documents/document';
import { EmailThread } from '../email/thread';
import { Form } from '../forms/form';
import { Channel } from './channel';

function shareClient() {
  const requests: unknown[] = [];
  const client = {
    storage: {
      shareWithChannel: async (options: unknown) => {
        requests.push(options);
        return { data: undefined };
      },
    },
  } as unknown as MacroClient;
  return { client, requests };
}

describe('shareWithChannel', () => {
  test('each handle grants the channel its own stored entity type', async () => {
    const { client, requests } = shareClient();
    const channel = Channel.byId(client, 'channel-1');

    await Document.byId(client, 'document-1').shareWithChannel(channel);
    await EmailThread.byId(client, 'thread-1').shareWithChannel(channel);
    await Form.byId(client, 'form-1').shareWithChannel(channel);

    expect(requests).toEqual([
      {
        path: { channel_id: 'channel-1' },
        body: { entityType: 'document', entityId: 'document-1' },
      },
      {
        path: { channel_id: 'channel-1' },
        body: { entityType: 'thread', entityId: 'thread-1' },
      },
      {
        path: { channel_id: 'channel-1' },
        body: { entityType: 'form', entityId: 'form-1' },
      },
    ]);
  });
});
