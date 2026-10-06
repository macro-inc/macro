import { err, ok } from 'neverthrow';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  updateTags: vi.fn(),
  refresh: vi.fn(),
  failure: vi.fn(),
}));
vi.mock('@core/util/create', () => ({ createMarkdownFile: mocks.create }));
vi.mock('@core/component/Toast/Toast', () => ({
  toast: { failure: mocks.failure },
}));
vi.mock('@queries/soup/cache', () => ({ refetchSoupEntity: mocks.refresh }));
vi.mock('@service-properties/client', () => ({
  propertiesServiceClient: {
    bulkUpdateEntityPropertyOptions: mocks.updateTags,
  },
}));

import { createDocumentWithTags } from './create-document-with-tags';

beforeEach(() => {
  vi.resetAllMocks();
  mocks.create.mockResolvedValue('document-id');
  mocks.updateTags.mockResolvedValue(ok({}));
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

  it('persists personal and team tags and refreshes the created entity', async () => {
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
      entity_type: 'DOCUMENT',
      entity_id: 'document-id',
      body: {
        properties: [
          {
            property_id: 'personal',
            add_option_ids: ['tag-1', 'tag-2'],
            remove_option_ids: [],
          },
          {
            property_id: 'team',
            add_option_ids: ['tag-3'],
            remove_option_ids: [],
          },
        ],
      },
    });
    expect(mocks.refresh).toHaveBeenCalledWith('document-id', 'document', {
      refreshGraphql: true,
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

  it.each(['result', 'throw'])(
    'keeps the created document when tag saving fails via %s',
    async (failure) => {
      if (failure === 'result')
        mocks.updateTags.mockResolvedValue(err(new Error('offline')));
      else mocks.updateTags.mockRejectedValue(new Error('offline'));
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
    }
  );
});
