import { describe, expect, test } from 'bun:test';
import type { CreateMarkdownHandlerData } from '../../../generated/storage/types.gen';
import type { MacroClient } from '../../utils/client';
import { MacroError } from '../../utils/unwrap';
import { DocumentNamespace } from './namespace';

const DOCUMENT_ID = '0190b6a5-6a40-7c4e-8b1e-2f6d1f0a9c11';

describe('documents.create', () => {
  test('refuses an unknown option instead of creating an empty document', async () => {
    const requests: CreateMarkdownHandlerData['body'][] = [];
    const client = {
      storage: {
        createMarkdownHandler: async ({
          body,
        }: Pick<CreateMarkdownHandlerData, 'body'>) => {
          requests.push(body);
          return { data: { documentId: DOCUMENT_ID } };
        },
      },
    } as unknown as MacroClient;
    const documents = new DocumentNamespace(client);

    // Code-mode programs are plain JavaScript, so nothing stops this call
    // before it runs.
    const call = documents.create({
      name: 'Launch plan',
      content: '- Ship it',
    } as unknown as Parameters<DocumentNamespace['create']>[0]);

    await expect(call).rejects.toThrow(MacroError);
    await expect(call).rejects.toThrow(
      'documents.create does not take `content`; its options are `name`, `markdown`, `project`.',
    );
    expect(requests).toEqual([]);
  });

  test('creates a document from its markdown option', async () => {
    const requests: CreateMarkdownHandlerData['body'][] = [];
    const client = {
      storage: {
        createMarkdownHandler: async ({
          body,
        }: Pick<CreateMarkdownHandlerData, 'body'>) => {
          requests.push(body);
          return { data: { documentId: DOCUMENT_ID } };
        },
      },
    } as unknown as MacroClient;
    const documents = new DocumentNamespace(client);

    const document = await documents.create({
      name: 'Launch plan',
      markdown: '- Ship it',
    });

    expect(document.id).toBe(DOCUMENT_ID);
    expect(requests).toEqual([
      { documentName: 'Launch plan', markdown: '- Ship it', projectId: null },
    ]);
  });
});
