import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  updateTags: vi.fn(),
  failure: vi.fn(),
  current: vi.fn(),
}));
vi.mock('@core/util/create', () => ({ createMarkdownFile: mocks.create }));
vi.mock('@core/component/Toast/Toast', () => ({
  toast: { failure: mocks.failure },
}));
vi.mock('@queries/properties/graphql/created-entity-tags', () => ({
  saveCreatedEntityTags: mocks.updateTags,
}));
vi.mock('@graphql-cache/session-generation', () => ({
  cacheSessionGeneration: {
    capture: () => 'initial',
    isCurrent: mocks.current,
  },
}));

import { createDocumentWithTags } from './create-document-with-tags';

beforeEach(() => {
  vi.resetAllMocks();
  mocks.create.mockResolvedValue('document-id');
  mocks.updateTags.mockResolvedValue(undefined);
  mocks.current.mockReturnValue(true);
});

describe('slash document creation', () => {
  it('starts optimism before the request and creates normal markdown without task defaults', async () => {
    const start = vi.fn();
    const history = vi.fn();
    mocks.create.mockImplementation(async () => {
      expect(start).toHaveBeenCalledOnce();
      return 'document-id';
    });
    expect(
      await createDocumentWithTags(
        'Title',
        '**Body**',
        [],
        new Map(),
        history,
        { onMutate: start }
      )
    ).toEqual({ documentId: 'document-id' });
    expect(mocks.create).toHaveBeenCalledWith({
      title: 'Title',
      content: '**Body**',
      source: 'document_composer',
    });
    expect(history).toHaveBeenCalledWith({
      itemId: 'document-id',
      itemType: 'document',
    });
    expect(mocks.updateTags).not.toHaveBeenCalled();
  });

  it('submits personal and team tag additions with the new document identity', async () => {
    await createDocumentWithTags(
      'Title',
      'Body',
      [
        [
          'personal',
          { valueType: 'SELECT_STRING', values: ['tag-1', 'tag-2'] },
        ],
        ['team', { valueType: 'SELECT_STRING', values: ['tag-3'] }],
        ['empty', { valueType: 'SELECT_STRING', values: [] }],
      ],
      new Map(),
      vi.fn()
    );
    expect(mocks.updateTags).toHaveBeenCalledWith({
      entityType: 'DOCUMENT',
      entityId: 'document-id',
      properties: [
        {
          propertyDefinitionId: 'personal',
          addOptionIds: ['tag-1', 'tag-2'],
          removeOptionIds: [],
        },
        {
          propertyDefinitionId: 'team',
          addOptionIds: ['tag-3'],
          removeOptionIds: [],
        },
      ],
    });
  });

  it('does not save tags or history after failed creation', async () => {
    mocks.create.mockResolvedValue(undefined);
    const history = vi.fn();
    expect(
      await createDocumentWithTags('Title', '', [], new Map(), history)
    ).toBeNull();
    expect(history).not.toHaveBeenCalled();
    expect(mocks.updateTags).not.toHaveBeenCalled();
  });

  it('keeps the created document when tag saving fails', async () => {
    mocks.updateTags.mockRejectedValue(new Error('write denied'));
    expect(
      await createDocumentWithTags(
        'Title',
        '',
        [['personal', { valueType: 'SELECT_STRING', values: ['tag-1'] }]],
        new Map(),
        vi.fn()
      )
    ).toEqual({ documentId: 'document-id' });
    expect(mocks.failure).toHaveBeenCalledWith(
      expect.stringContaining('Document created, but tags')
    );
    expect(mocks.create).toHaveBeenCalledOnce();
  });

  it('does not submit the old draft after the viewer changes', async () => {
    mocks.current.mockReturnValue(false);
    const history = vi.fn();
    await createDocumentWithTags(
      'Title',
      '',
      [['personal', { valueType: 'SELECT_STRING', values: ['tag-1'] }]],
      new Map(),
      history
    );
    expect(mocks.current).toHaveBeenCalledWith('initial');
    expect(history).not.toHaveBeenCalled();
    expect(mocks.updateTags).not.toHaveBeenCalled();
  });
});
