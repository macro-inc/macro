import { describe, expect, test } from 'bun:test';
import type { EditDocumentMarkdownData } from '../../../generated/storage/types.gen';
import {
  DocumentBlock,
  DocumentBusyError,
  DocumentChangedError,
  EditOutcomeUnknownError,
  MarkdownEditsRefusedError,
} from '../../macro';
import type { MacroClient } from '../../utils/client';
import { Document } from '../documents/document';

type EditRequest = Pick<EditDocumentMarkdownData, 'path' | 'body'>;

function clientAnswering(answer: unknown): {
  client: MacroClient;
  requests: EditRequest[];
} {
  const requests: EditRequest[] = [];
  const client = {
    webAppUrl: 'https://macro.example',
    storage: {
      getDocumentMarkdownBlocks: async () => ({
        data: {
          revision: 'AQID',
          blocks: [
            { id: 'h1', type: 'heading', markdown: '# Plan' },
            { id: 'p1', type: 'paragraph', markdown: 'Ships in Q3.' },
            {
              id: 'v1',
              type: 'paragraph',
              markdown: '<!-- keep:v1 -->',
              opaque: true,
            },
          ],
        },
        response: { status: 200 },
      }),
      editDocumentMarkdown: async (request: EditRequest) => {
        requests.push(request);
        return answer;
      },
    },
  } as unknown as MacroClient;
  return { client, requests };
}

const COMMITTED = {
  data: {
    outcome: 'committed',
    revision: 'AQIE',
    merge: 'base',
    changes: [
      {
        kind: 'edited',
        blockId: 'p1',
        before: 'Ships in Q3.',
        after: 'Ships in Q4.',
      },
      {
        kind: 'inserted',
        blockId: 'n1',
        afterBlockId: null,
        markdown: '# Top',
      },
      { kind: 'deleted', blockId: 'v1', markdown: '<!-- keep:v1 -->' },
      { kind: 'moved', blockId: 'h1', afterBlockId: 'n1' },
    ],
  },
  response: { status: 200 },
};

describe('document.applyMarkdownEdits', () => {
  test('sends every edit shape against the read and returns block handles', async () => {
    const { client, requests } = clientAnswering(COMMITTED);
    const document = Document.byId(client, 'doc');
    const read = await document.markdownBlocks();
    const [heading, paragraph, opaque] = read.blocks;

    const result = await document.applyMarkdownEdits(
      [
        { replace: 'Q3', with: 'Q4', in: paragraph },
        { replace: 'Plan', with: 'Plans', all: true },
        { insert: '# Top', before: 'start' },
        { insert: 'Footer.', after: paragraph },
        { remove: opaque },
        { move: heading, after: 'end' },
        { move: heading, before: paragraph },
      ],
      { base: read, dryRun: true },
    );

    expect(opaque.opaque).toBe(true);
    expect(requests).toEqual([
      {
        path: { document_id: 'doc' },
        body: {
          edits: [
            { old: 'Q3', new: 'Q4', block_id: 'p1' },
            { old: 'Plan', new: 'Plans', replace_all: true },
            { insert_before: 'start', markdown: '# Top' },
            { insert_after: 'p1', markdown: 'Footer.' },
            { delete: 'v1' },
            { move: 'h1', after: 'end' },
            { move: 'h1', before: 'p1' },
          ],
          baseRevision: 'AQID',
          dryRun: true,
          allowDeletingContent: undefined,
        },
      },
    ]);
    expect(result.outcome).toBe('committed');
    expect(result.webUrl).toContain('doc');
    expect(result.changes.map((change) => change.block.toJSON())).toEqual([
      { id: 'p1', documentId: 'doc', markdown: 'Ships in Q4.' },
      { id: 'n1', documentId: 'doc', markdown: '# Top' },
      { id: 'v1', documentId: 'doc', markdown: '<!-- keep:v1 -->' },
      { id: 'h1', documentId: 'doc' },
    ]);
    const inserted = result.changes[1];
    const moved = result.changes[3];
    expect(inserted.kind === 'inserted' && inserted.after).toBeNull();
    expect(moved.kind === 'moved' && moved.after?.id).toBe('n1');
  });

  test('a block of another document is refused before anything is sent', async () => {
    const { client, requests } = clientAnswering(COMMITTED);
    const other = DocumentBlock.byId(Document.byId(client, 'other'), 'p1');

    await expect(
      Document.byId(client, 'doc').applyMarkdownEdits([{ remove: other }]),
    ).rejects.toThrow('does not belong to document doc');
    expect(requests).toEqual([]);
  });

  test('a refusal throws with its code, edit and matching blocks', async () => {
    const { client } = clientAnswering({
      error: {
        error: 'edit_refused',
        message: 'edit 1: old occurs 2 times',
        refusal: {
          code: 'ambiguous_match',
          message: 'edit 1: old occurs 2 times',
          edit: 1,
          blocks: [{ blockId: 'p1', occurrences: 2, markdown: 'Q3 and Q3' }],
        },
      },
      response: { status: 422 },
    });

    const thrown = await Document.byId(client, 'doc')
      .applyMarkdownEdits([{ replace: 'Q3', with: 'Q4' }])
      .catch((error: unknown) => error);

    expect(thrown).toBeInstanceOf(MarkdownEditsRefusedError);
    const refused = thrown as MarkdownEditsRefusedError;
    expect(refused.code).toBe('ambiguous_match');
    expect(refused.edit).toBe(1);
    expect(refused.blocks[0].occurrences).toBe(2);
    expect(refused.blocks[0].block.toJSON()).toEqual({
      id: 'p1',
      documentId: 'doc',
      markdown: 'Q3 and Q3',
    });
  });

  test('a gone match is DocumentChangedError, a busy document DocumentBusyError and a 502 an unknown outcome', async () => {
    const conflict = clientAnswering({
      error: {
        error: 'revision_conflict',
        message: 'gone',
        conflict: 'changed',
      },
      response: { status: 409 },
    });
    const busy = clientAnswering({
      error: { error: 'revision_conflict', message: 'busy', conflict: 'busy' },
      response: { status: 409 },
    });
    const failed = clientAnswering({
      error: { error: 'edit_failed', message: 'may have applied' },
      response: { status: 502 },
    });

    const changed = await Document.byId(conflict.client, 'doc')
      .applyMarkdownEdits([{ replace: 'Q3', with: 'Q4' }])
      .catch((error: unknown) => error);
    const retry = await Document.byId(busy.client, 'doc')
      .applyMarkdownEdits([{ replace: 'Q3', with: 'Q4' }])
      .catch((error: unknown) => error);
    const unknown = await Document.byId(failed.client, 'doc')
      .applyMarkdownEdits([{ replace: 'Q3', with: 'Q4' }])
      .catch((error: unknown) => error);

    expect(changed).toBeInstanceOf(DocumentChangedError);
    expect(retry).toBeInstanceOf(DocumentBusyError);
    expect(unknown).toBeInstanceOf(EditOutcomeUnknownError);
  });
});
