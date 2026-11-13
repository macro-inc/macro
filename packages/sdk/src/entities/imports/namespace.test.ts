import { describe, expect, test } from 'bun:test';
// Load the SDK first: documents/document.ts and tasks/task.ts import each other.
import '../../macro';
import type { ImportEntity } from '../../../generated/cognition/types.gen';
import type { MacroClient } from '../../utils/client';
import { Document } from '../documents/document';
import { Task } from '../tasks/task';
import { ImportNamespace } from './namespace';

const ROW: ImportEntity = {
  id: 'row-1',
  user_id: 'macro|teammate@example.com',
  team_id: null,
  source: 'linear',
  kind: 'issue',
  foreign_id: 'ENG-142',
  parent_id: null,
  review_id: null,
  status: 'imported',
  initiator: 'chat',
  metadata: { identifier: 'ENG-142', title: 'Roadmap' },
  entity_id: 'task-1',
  entity_type: 'task',
  last_error: null,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
};

function importsClient() {
  const requests: [string, unknown][] = [];
  const client = {
    cognition: {
      listImportEntities: async (options: unknown) => {
        requests.push(['list', options]);
        return { data: { entities: [ROW] } };
      },
      trackImportEntity: async (options: unknown) => {
        requests.push(['track', options]);
        return {
          data: { outcome: 'already_imported_by_teammate', entity: ROW },
        };
      },
      declineImportEntity: async (options: unknown) => {
        requests.push(['decline', options]);
        return { data: undefined };
      },
      importNotionPage: async (options: unknown) => {
        requests.push(['notion', options]);
        return {
          data: {
            outcome: 'imported',
            entity: {
              ...ROW,
              source: 'notion',
              kind: 'page',
              entity_id: 'doc-1',
              entity_type: 'md',
            },
          },
        };
      },
    },
  } as unknown as MacroClient;
  return { client, requests };
}

describe('ImportNamespace', () => {
  test('list returns entries whose item is the Macro handle they became', async () => {
    const { client, requests } = importsClient();

    const [entry] = await new ImportNamespace(client).list({
      source: 'linear',
      status: 'imported',
    });

    expect(requests).toEqual([
      ['list', { query: { source: 'linear', status: 'imported' } }],
    ]);
    expect(entry?.foreignId).toBe('ENG-142');
    expect(entry?.importedBy().id).toBe('macro|teammate@example.com');
    const item = entry?.item();
    expect(item).toBeInstanceOf(Task);
    expect(item?.id).toBe('task-1');
  });

  test('track stages and recordImported sends the created item', async () => {
    const { client, requests } = importsClient();
    const imports = new ImportNamespace(client);
    const candidate = {
      source: 'linear' as const,
      foreignId: 'ENG-142',
      metadata: { identifier: 'ENG-142', title: 'Roadmap' },
    };

    const tracked = await imports.track(candidate);
    await imports.recordImported(candidate, Task.byId(client, 'task-1'));

    expect(tracked.outcome).toBe('already_imported_by_teammate');
    expect(requests).toEqual([
      [
        'track',
        {
          body: {
            source: 'linear',
            foreignId: 'ENG-142',
            status: 'staged',
            metadata: { identifier: 'ENG-142', title: 'Roadmap' },
            entityId: undefined,
          },
        },
      ],
      [
        'track',
        {
          body: {
            source: 'linear',
            foreignId: 'ENG-142',
            status: 'imported',
            metadata: { identifier: 'ENG-142', title: 'Roadmap' },
            entityId: 'task-1',
          },
        },
      ],
    ]);
  });

  test('importNotionPage returns the document and decline deletes the entry', async () => {
    const { client, requests } = importsClient();

    const { outcome, entry } = await new ImportNamespace(
      client,
    ).importNotionPage('https://www.notion.so/Roadmap-0123456789abcdef');
    await entry.decline();

    expect(outcome).toBe('imported');
    expect(entry.item()).toBeInstanceOf(Document);
    expect(requests).toEqual([
      [
        'notion',
        { body: { page: 'https://www.notion.so/Roadmap-0123456789abcdef' } },
      ],
      ['decline', { path: { id: 'row-1' } }],
    ]);
  });

  test('recordImported refuses an item of the wrong kind for its source', async () => {
    const { client, requests } = importsClient();

    await expect(
      new ImportNamespace(client).recordImported(
        { source: 'notion', foreignId: 'page', metadata: { title: 'Roadmap' } },
        Task.byId(client, 'task-1'),
      ),
    ).rejects.toThrow('A notion import is recorded as a document');
    expect(requests).toEqual([]);
  });
});
