import type { EntityItem } from '@core/context/quickAccess';
import type { InitiativeEntity } from '@entity';
import type { LexicalEditor } from 'lexical';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { trackMention } = vi.hoisted(() => ({ trackMention: vi.fn() }));
vi.mock('@core/signal/mention', () => ({ trackMention }));
// The block table loads every block module; entities here never need it.
vi.mock('@core/constant/allBlocks', () => ({ fileTypeToBlockName: vi.fn() }));
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

import { createItemHandler } from './mentionHandlers';

const item: EntityItem<InitiativeEntity> = {
  kind: 'entity',
  bucket: 'initiative',
  id: 'initiative-1',
  searchText: 'Roadmap',
  sortTimestamp: 0,
  timestamps: {},
  data: {
    type: 'initiative',
    id: 'initiative-1',
    name: 'Roadmap',
    ownerId: 'owner',
  },
};

describe('task project menu selection', () => {
  beforeEach(() => {
    trackMention.mockReset();
  });

  it('inserts an initiative block mention tracked against the project', async () => {
    trackMention.mockResolvedValue('mention-uuid');
    const dispatchCommand = vi.fn();
    const onDocumentMention = vi.fn();
    const handler = createItemHandler({
      editor: { dispatchCommand } as unknown as LexicalEditor,
      blockId: 'doc-1',
      blockName: 'md',
      onDocumentMention,
    });
    await handler(item);
    expect(trackMention).toHaveBeenCalledWith(
      'doc-1',
      'initiative',
      'initiative-1'
    );
    expect(dispatchCommand).toHaveBeenNthCalledWith(2, 'insert-document', {
      documentId: 'initiative-1',
      documentName: 'Roadmap',
      blockName: 'initiative',
      mentionUuid: 'mention-uuid',
      channelType: undefined,
    });
    // Composers share or attach mentioned files; a project is neither.
    expect(onDocumentMention).not.toHaveBeenCalled();
  });
});
