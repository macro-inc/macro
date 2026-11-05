import { describe, expect, test } from 'bun:test';
import type { EntityMessageCreateData } from '../../../generated/storage/types.gen';
import { MacroError } from '../../utils';
import type { MacroClient } from '../../utils/client';
import { Document } from '../documents/document';
import { StaticImage } from '../images/image';
import { Channel } from './channel';
import { Thread } from './thread';

function recordingClient(): {
  client: MacroClient;
  bodies: EntityMessageCreateData['body'][];
} {
  const bodies: EntityMessageCreateData['body'][] = [];
  const client = {
    authConfig: { type: 'user' },
    hosts: { 'static-files': 'https://static.example' },
    storage: {
      entityMessageCreate: async ({
        body,
      }: {
        body: EntityMessageCreateData['body'];
      }) => {
        bodies.push(body);
        return { data: { id: 'message' } };
      },
    },
  } as unknown as MacroClient;
  return { client, bodies };
}

describe('channel.send with documents', () => {
  test('attaches each document after the images', async () => {
    const { client, bodies } = recordingClient();

    await Channel.byId(client, 'channel').send('the plan and the chart', {
      images: [StaticImage.byId(client, 'chart', { width: 640, height: 480 })],
      documents: [Document.byId(client, 'plan')],
    });

    expect(bodies.map((body) => body.attachments)).toEqual([
      [
        {
          entity_type: 'static/image',
          entity_id: 'chart',
          width: 640,
          height: 480,
        },
        {
          entity_type: 'document',
          entity_id: 'plan',
          width: null,
          height: null,
        },
      ],
    ]);
  });

  test('replies in a thread with a document attached', async () => {
    const { client, bodies } = recordingClient();

    await new Thread(client, 'channel', 'root').reply('here it is', {
      documents: [Document.byId(client, 'plan')],
    });

    expect(bodies).toHaveLength(1);
    expect(bodies[0]?.thread_id).toBe('root');
    expect(bodies[0]?.attachments).toEqual([
      {
        entity_type: 'document',
        entity_id: 'plan',
        width: null,
        height: null,
      },
    ]);
  });

  test('a user-owned bot on the webhook endpoint refuses documents', async () => {
    const client = {
      authConfig: { type: 'bot' },
      hasActingUser: () => false,
      selfBot: async () => ({ owner: { type: 'user' } }),
      storage: {
        postChannelBotWebhook: async () => {
          throw new Error('must not post');
        },
      },
    } as unknown as MacroClient;

    await expect(
      Channel.byId(client, 'channel').send('the plan', {
        documents: [Document.byId(client, 'plan')],
      }),
    ).rejects.toBeInstanceOf(MacroError);
  });
});
