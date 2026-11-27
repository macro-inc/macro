import { describe, expect, test } from 'bun:test';
import { ChatNamespace } from '../src/entities/chats/namespace';
import { DocumentNamespace } from '../src/entities/documents/namespace';
import { ProjectNamespace } from '../src/entities/projects/namespace';
import { TaskNamespace } from '../src/entities/tasks/namespace';
import type { MacroClient } from '../src/utils/client';

/** A client whose search returns `results` and that records detail requests. */
function searchClient(results: unknown[]) {
  const detailRequests: string[] = [];
  const detail = (name: string) => async () => {
    detailRequests.push(name);
    throw new Error(`unexpected detail request ${name}`);
  };
  const client = {
    webAppUrl: 'https://macro.example.test',
    search: {
      unifiedSearch: async () => ({ data: { results, next_cursor: null } }),
    },
    storage: {
      getDocument: detail('getDocument'),
      getProjectHandler: detail('getProjectHandler'),
    },
    cognition: { getChat: detail('getChat') },
  } as unknown as MacroClient;
  return { client, detailRequests };
}

function documentHit(id: string, name: string, fileType: string | null) {
  return {
    type: 'document',
    id,
    document_id: id,
    document_name: name,
    name,
    owner_id: 'macro|owner@example.com',
    file_type: fileType,
    document_search_results: [],
  };
}

describe('per-type search hits', () => {
  test('documents.search hits read name, owner and file type without a detail request', async () => {
    const { client, detailRequests } = searchClient([
      documentHit('doc-1', 'Meta spend', 'md'),
      documentHit('doc-2', 'Ad board', 'canvas'),
    ]);

    const read = [];
    for await (const doc of new DocumentNamespace(client).search('spend')) {
      read.push({
        name: await doc.name(),
        owner: (await doc.owner()).id,
        fileType: await doc.fileType(),
        url: doc.webUrl(),
      });
    }

    expect(read).toEqual([
      {
        name: 'Meta spend',
        owner: 'macro|owner@example.com',
        fileType: 'md',
        url: 'https://macro.example.test/app/md/doc-1',
      },
      {
        name: 'Ad board',
        owner: 'macro|owner@example.com',
        fileType: 'canvas',
        url: 'https://macro.example.test/app/canvas/doc-2',
      },
    ]);
    expect(detailRequests).toEqual([]);
  });

  test('tasks.search hits read their name without a detail request', async () => {
    const { client, detailRequests } = searchClient([
      {
        ...documentHit('task-1', 'Ship the trial report', 'md'),
        sub_type: 'task',
      },
    ]);

    const names = [];
    for await (const task of new TaskNamespace(client).search('trial'))
      names.push(await task.name());

    expect(names).toEqual(['Ship the trial report']);
    expect(detailRequests).toEqual([]);
  });

  test('chats.search hits read their name without a detail request', async () => {
    const { client, detailRequests } = searchClient([
      {
        type: 'chat',
        id: 'chat-1',
        chat_id: 'chat-1',
        name: 'Spend questions',
        owner_id: 'macro|owner@example.com',
        user_id: 'macro|owner@example.com',
        chat_search_results: [],
      },
    ]);

    const names = [];
    for await (const chat of new ChatNamespace(client).search('spend'))
      names.push(await chat.name());

    expect(names).toEqual(['Spend questions']);
    expect(detailRequests).toEqual([]);
  });

  test('projects.search hits read their name without a detail request', async () => {
    const { client, detailRequests } = searchClient([
      {
        type: 'project',
        id: 'project-1',
        name: 'Launch',
        owner_id: 'macro|owner@example.com',
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-01T00:00:00Z',
        project_search_results: [],
      },
    ]);

    const names = [];
    for await (const project of new ProjectNamespace(client).search('launch'))
      names.push(await project.name());

    expect(names).toEqual(['Launch']);
    expect(detailRequests).toEqual([]);
  });

  test('a field the hit does not carry still loads the detail', async () => {
    const { client, detailRequests } = searchClient([
      documentHit('doc-1', 'Meta spend', 'md'),
    ]);

    for await (const doc of new DocumentNamespace(client).search('spend')) {
      await doc.updatedAt().catch(() => undefined);
    }

    expect(detailRequests).toEqual(['getDocument']);
  });
});
