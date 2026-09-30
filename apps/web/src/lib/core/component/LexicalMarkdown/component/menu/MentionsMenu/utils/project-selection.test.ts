import type { LexicalEditor } from 'lexical';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { trackMention } = vi.hoisted(() => ({ trackMention: vi.fn() }));
vi.mock('@core/signal/mention', () => ({ trackMention }));
vi.mock('./entityUtils', () => ({ getBlockNameFromEntity: vi.fn(() => 'md') }));
vi.mock('../../../../plugins', () => ({
  REMOVE_INLINE_SEARCH_COMMAND: 'remove-search',
}));
vi.mock('../../../../plugins/mentions', () => ({
  INSERT_AGENT_SESSION_MENTION_COMMAND: 'insert-session',
  INSERT_DOCUMENT_MENTION_COMMAND: 'insert-document',
  INSERT_DATE_MENTION_COMMAND: 'insert-date',
  INSERT_GROUP_MENTION_COMMAND: 'insert-group',
}));
vi.mock('../../../../utils/mentionsUtils', () => ({
  handleUserMention: vi.fn(),
}));

import type { EntityItem } from '@core/context/quickAccess';
import type {
  MentionItem,
  ProjectMentionItem,
} from '../../../../utils/mentionsUtils';
import { createItemHandler } from './mentionHandlers';
import { mergeIntoDocuments, sortMobileMentions } from './mobileSort';

const item: ProjectMentionItem = {
  kind: 'project',
  id: 'project-1',
  searchText: 'Launch',
  sortTimestamp: Date.parse('2026-09-01T00:00:00.000Z'),
  timestamps: { updatedAt: '2026-09-01T00:00:00.000Z', viewedAt: undefined },
  data: { name: 'Launch' },
};

describe('project menu selection', () => {
  beforeEach(() => {
    trackMention.mockReset();
  });

  it('inserts an initiative document mention without attachment callbacks', async () => {
    const dispatchCommand = vi.fn();
    const onDocumentMention = vi.fn();
    const handler = createItemHandler({
      editor: { dispatchCommand } as unknown as LexicalEditor,
      onDocumentMention,
    });
    await handler(item);
    expect(dispatchCommand).toHaveBeenNthCalledWith(
      1,
      'remove-search',
      undefined
    );
    expect(dispatchCommand).toHaveBeenNthCalledWith(2, 'insert-document', {
      documentId: 'project-1',
      documentName: 'Launch',
      blockName: 'initiative',
    });
    expect(onDocumentMention).not.toHaveBeenCalled();
    expect(trackMention).not.toHaveBeenCalled();
  });

  it('records the document reference against the initiative', async () => {
    trackMention.mockResolvedValue('mention-uuid');
    const dispatchCommand = vi.fn();
    const handler = createItemHandler({
      editor: { dispatchCommand } as unknown as LexicalEditor,
      blockId: 'doc-1',
      blockName: 'md',
    });
    await handler(item);
    expect(trackMention).toHaveBeenCalledWith(
      'doc-1',
      'initiative',
      'project-1'
    );
    expect(dispatchCommand).toHaveBeenNthCalledWith(2, 'insert-document', {
      documentId: 'project-1',
      documentName: 'Launch',
      blockName: 'initiative',
      mentionUuid: 'mention-uuid',
    });
  });

  it('does not track when the host is a channel or chat composer', async () => {
    for (const blockName of ['channel', 'chat'] as const) {
      const handler = createItemHandler({
        editor: { dispatchCommand: vi.fn() } as unknown as LexicalEditor,
        blockId: 'host-1',
        blockName,
      });
      await handler(item);
      expect(trackMention).not.toHaveBeenCalled();
    }
  });

  it('participates in the mobile search list', () => {
    expect(sortMobileMentions([item], 'Laun')).toEqual([item]);
  });
});

const doc = (id: string, name: string, viewedAt: string) =>
  ({
    kind: 'entity',
    bucket: 'document',
    id,
    searchText: name,
    sortTimestamp: Date.parse(viewedAt),
    timestamps: { viewedAt, updatedAt: viewedAt },
    data: { id, name, type: 'document' },
  }) as unknown as EntityItem;

const project = (
  id: string,
  name: string,
  times: { viewedAt?: string; updatedAt: string }
): ProjectMentionItem => ({
  kind: 'project',
  id,
  searchText: name,
  sortTimestamp: Date.parse(times.viewedAt ?? times.updatedAt),
  timestamps: times,
  data: { name },
});

describe('projects in the documents section', () => {
  // Quick access order with no query: most recently viewed first.
  const docs = [
    doc('d1', 'Launch notes', '2026-09-27T00:00:00.000Z'),
    doc('d2', 'Quarterly plan', '2026-09-20T00:00:00.000Z'),
    doc('d3', 'Random scratch', '2026-09-01T00:00:00.000Z'),
  ];
  const ids = (items: MentionItem[]) => items.map((i) => i.id);

  it('slots projects into document recency by when they were viewed', () => {
    const merged = mergeIntoDocuments(
      docs,
      [
        // Updated today by task churn, but last viewed between d2 and d3.
        project('p1', 'Roadmap', {
          viewedAt: '2026-09-10T00:00:00.000Z',
          updatedAt: '2026-09-28T00:00:00.000Z',
        }),
        project('p2', 'Hiring', { updatedAt: '2026-09-24T00:00:00.000Z' }),
      ],
      ''
    );
    expect(ids(merged)).toEqual(['d1', 'p2', 'd2', 'p1', 'd3']);
  });

  it('keeps its rank position among server-ranked documents', () => {
    // Server order is kept; one document outranks the project, so it is second.
    const serverRanked = [docs[2], docs[0], docs[1]];
    const merged = mergeIntoDocuments(
      serverRanked,
      [project('p1', 'Hiring', { updatedAt: '2026-09-24T00:00:00.000Z' })],
      ''
    );
    expect(ids(merged)).toEqual(['d3', 'p1', 'd1', 'd2']);
  });

  it('ranks with the documents search when there is a query', () => {
    const merged = ids(
      mergeIntoDocuments(
        docs,
        [project('p1', 'Launch', { updatedAt: '2026-09-25T00:00:00.000Z' })],
        'launch'
      )
    );
    expect(merged.filter((id) => id.startsWith('d'))).toEqual([
      'd1',
      'd2',
      'd3',
    ]);
    expect(merged.indexOf('p1')).toBeLessThan(merged.indexOf('d3'));
  });

  it('returns the documents untouched when there are no projects', () => {
    expect(mergeIntoDocuments(docs, [], 'x')).toBe(docs);
  });
});
