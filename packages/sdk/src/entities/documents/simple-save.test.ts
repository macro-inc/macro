import { describe, expect, test } from 'bun:test';
import type { MacroClient } from '../../utils/client';
import { DocumentNamespace } from './namespace';

describe('document.simpleSave', () => {
  test('sends the content as the multipart file', async () => {
    const saves: { documentId: string; text: string }[] = [];
    const client = {
      storage: {
        simpleSave: async (request: {
          path: { document_id: string };
          body: { file: Blob };
        }) => {
          saves.push({
            documentId: request.path.document_id,
            text: await request.body.file.text(),
          });
          return { data: { data: {} }, response: { status: 200 } };
        },
      },
    } as unknown as MacroClient;

    await new DocumentNamespace(client).byId('doc').simpleSave('<p>new</p>');

    expect(saves).toEqual([{ documentId: 'doc', text: '<p>new</p>' }]);
  });
});
