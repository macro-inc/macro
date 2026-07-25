import type { SoupApiItem } from '@service-storage/generated/schemas';
import { describe, expect, it } from 'vitest';
import type { Query } from './filter-store/types';
import {
  soupItemMatchesProjectMembership,
  soupItemMatchesQuery,
} from './query-filters';

const documentItem = (id: string, overrides: object = {}): SoupApiItem =>
  ({ tag: 'document', data: { id, ...overrides } }) as unknown as SoupApiItem;

const taggedTaskItem = (id: string, optionIds: string[]): SoupApiItem =>
  documentItem(id, {
    subType: { type: 'task' },
    properties: optionIds.map((optionId) => ({
      value: { type: 'SelectOption', value: [optionId] },
    })),
  });

const taskItem = (id: string): SoupApiItem =>
  documentItem(id, { subType: { type: 'task' } });

const emailItem = (id: string): SoupApiItem =>
  ({ tag: 'emailThread', data: { id } }) as unknown as SoupApiItem;

const chatItem = (id: string, overrides: object = {}): SoupApiItem =>
  ({ tag: 'chat', data: { id, ...overrides } }) as unknown as SoupApiItem;

const projectItem = (id: string, overrides: object = {}): SoupApiItem =>
  ({ tag: 'project', data: { id, ...overrides } }) as unknown as SoupApiItem;

describe('soupItemMatchesQuery', () => {
  it('rejects entity types the query never references (nil-fill gating)', () => {
    // An email-scoped list: only threadId is referenced, everything else is
    // nil-filled by defineQueryFilters.
    const query: Query = { include: { threadId: ['thread-1'] } };

    expect(soupItemMatchesQuery(emailItem('thread-1'), query)).toBe(true);
    // A freshly created task/doc must NOT leak into an email-scoped list.
    expect(soupItemMatchesQuery(documentItem('doc-1'), query)).toBe(false);
    expect(soupItemMatchesQuery(chatItem('chat-1'), query)).toBe(false);
  });

  it('honors explicit id lists (items-mode refs)', () => {
    const query: Query = { include: { documentId: ['doc-1', 'doc-2'] } };

    expect(soupItemMatchesQuery(documentItem('doc-1'), query)).toBe(true);
    expect(soupItemMatchesQuery(documentItem('doc-2'), query)).toBe(true);
    expect(soupItemMatchesQuery(documentItem('doc-3'), query)).toBe(false);
    expect(soupItemMatchesQuery(emailItem('thread-1'), query)).toBe(false);
  });

  it('accepts any in-type item when the type is scoped by a non-id field', () => {
    // Referencing the document target via owner keeps documentId un-nil-filled,
    // so a new document owned by that user still matches optimistically.
    const query: Query = { include: { documentOwnerId: ['macro|me@x.com'] } };

    expect(
      soupItemMatchesQuery(
        documentItem('doc-new', { ownerId: 'macro|me@x.com' }),
        query
      )
    ).toBe(true);
    expect(
      soupItemMatchesQuery(
        documentItem('doc-other', { ownerId: 'macro|other@x.com' }),
        query
      )
    ).toBe(false);
    expect(soupItemMatchesQuery(emailItem('thread-1'), query)).toBe(false);
  });

  it('filters documents by sub type', () => {
    const query: Query = { include: { subType: ['task'] } };

    expect(
      soupItemMatchesQuery(
        documentItem('doc-task', { subType: { type: 'task' } }),
        query
      )
    ).toBe(true);
    expect(
      soupItemMatchesQuery(
        documentItem('doc-note', { subType: { type: 'note' } }),
        query
      )
    ).toBe(false);
  });

  it('rejects everything for an empty items-mode query', () => {
    const query: Query = { include: {} };

    expect(soupItemMatchesQuery(documentItem('doc-1'), query)).toBe(false);
    expect(soupItemMatchesQuery(emailItem('thread-1'), query)).toBe(false);
  });

  it('enforces an active tag filter within the scoped type', () => {
    // A task list scoped to a single tag option: a freshly created untagged
    // task is in-type but must not leak into a tag-scoped list.
    const query: Query = {
      include: {
        subType: ['task'],
        tagFilters: [{ propertyId: 'def-1', type: 'select', value: 'opt-1' }],
      },
    };

    expect(
      soupItemMatchesQuery(taggedTaskItem('doc-tagged', ['opt-1']), query)
    ).toBe(true);
    expect(soupItemMatchesQuery(taskItem('doc-untagged'), query)).toBe(false);
    expect(
      soupItemMatchesQuery(taggedTaskItem('doc-other-tag', ['opt-2']), query)
    ).toBe(false);
  });

  it('requires every option under tagFilterMode "all"', () => {
    const query: Query = {
      include: {
        subType: ['task'],
        tagFilterMode: 'all',
        tagFilters: [
          { propertyId: 'def-1', type: 'select', value: 'opt-1' },
          { propertyId: 'def-2', type: 'select', value: 'opt-2' },
        ],
      },
    };

    expect(
      soupItemMatchesQuery(
        taggedTaskItem('doc-both', ['opt-1', 'opt-2']),
        query
      )
    ).toBe(true);
    expect(
      soupItemMatchesQuery(taggedTaskItem('doc-one', ['opt-1']), query)
    ).toBe(false);
  });
});

describe('soupItemMatchesProjectMembership', () => {
  const PROJECT = 'proj-1';

  it('gates documents by their projectId', () => {
    expect(
      soupItemMatchesProjectMembership(
        documentItem('doc-in', { projectId: PROJECT }),
        PROJECT
      )
    ).toBe(true);
    // A task created/opened outside the folder must not leak in.
    expect(
      soupItemMatchesProjectMembership(
        documentItem('doc-other', { projectId: 'proj-2' }),
        PROJECT
      )
    ).toBe(false);
    // Root-level documents carry no project.
    expect(
      soupItemMatchesProjectMembership(
        documentItem('doc-root', { projectId: null }),
        PROJECT
      )
    ).toBe(false);
    expect(
      soupItemMatchesProjectMembership(documentItem('doc-none'), PROJECT)
    ).toBe(false);
  });

  it('gates chats by their projectId', () => {
    expect(
      soupItemMatchesProjectMembership(
        chatItem('chat-in', { projectId: PROJECT }),
        PROJECT
      )
    ).toBe(true);
    expect(
      soupItemMatchesProjectMembership(
        chatItem('chat-other', { projectId: 'proj-2' }),
        PROJECT
      )
    ).toBe(false);
  });

  it('gates child projects by their parentId', () => {
    expect(
      soupItemMatchesProjectMembership(
        projectItem('sub-in', { parentId: PROJECT }),
        PROJECT
      )
    ).toBe(true);
    expect(
      soupItemMatchesProjectMembership(
        projectItem('sub-other', { parentId: 'proj-2' }),
        PROJECT
      )
    ).toBe(false);
    // The folder itself is not one of its own children.
    expect(
      soupItemMatchesProjectMembership(
        projectItem(PROJECT, { parentId: null }),
        PROJECT
      )
    ).toBe(false);
  });

  it('stays permissive for types with no project on the item', () => {
    expect(
      soupItemMatchesProjectMembership(emailItem('thread-1'), PROJECT)
    ).toBe(true);
  });
});
