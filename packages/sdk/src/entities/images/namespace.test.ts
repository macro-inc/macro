import { describe, expect, test } from 'bun:test';
import type { GenerateImageRequest } from '../../../generated/cognition/types.gen';
import type { EntityMessageCreateData } from '../../../generated/storage/types.gen';
import type { MacroClient } from '../../utils/client';
import { Channel } from '../channels/channel';
import { Document } from '../documents/document';
import { StaticImage } from './image';
import { ImagesNamespace } from './namespace';

const STATIC_FILES = 'https://static.example';

describe('images.generate', () => {
  test('sends references as typed handles and returns a sized image', async () => {
    const requests: GenerateImageRequest[] = [];
    const client = {
      hosts: { 'static-files': STATIC_FILES },
      cognition: {
        generateImage: async ({ body }: { body: GenerateImageRequest }) => {
          requests.push(body);
          return {
            data: {
              staticFileId: 'generated',
              url: `${STATIC_FILES}/file/generated`,
              mimeType: 'image/png',
              sizeBytes: 2048,
              width: 1024,
              height: 576,
            },
          };
        },
      },
    } as unknown as MacroClient;

    const image = await new ImagesNamespace(client).generate({
      prompt: 'a lighthouse at dusk',
      aspectRatio: 'widescreen',
      referenceImages: [
        Document.byId(client, 'document'),
        StaticImage.byId(client, 'upload'),
      ],
    });

    expect(requests).toEqual([
      {
        prompt: 'a lighthouse at dusk',
        aspectRatio: 'widescreen',
        referenceImages: [
          { type: 'document', id: 'document' },
          { type: 'staticFile', id: 'upload' },
        ],
      },
    ]);
    expect(image.toJSON()).toEqual({
      id: 'generated',
      url: `${STATIC_FILES}/file/generated`,
      width: 1024,
      height: 576,
      mimeType: 'image/png',
      sizeBytes: 2048,
      note: undefined,
    });
  });
});

describe('channel.send with images', () => {
  test('attaches each image as a sized static image', async () => {
    const bodies: EntityMessageCreateData['body'][] = [];
    const client = {
      authConfig: { type: 'user' },
      hosts: { 'static-files': STATIC_FILES },
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

    await Channel.byId(client, 'channel').send('look', {
      images: [
        StaticImage.byId(client, 'sized', { width: 640, height: 480 }),
        StaticImage.byId(client, 'unsized'),
      ],
    });

    expect(bodies.map((body) => body.attachments)).toEqual([
      [
        {
          entity_type: 'static/image',
          entity_id: 'sized',
          width: 640,
          height: 480,
        },
        {
          entity_type: 'static/image',
          entity_id: 'unsized',
          width: null,
          height: null,
        },
      ],
    ]);
  });
});
