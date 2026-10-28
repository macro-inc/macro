import type { EntityItem } from '@core/context/quickAccess';
import type { CrmCompanyEntity, CrmContactEntity } from '@entity';
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

const company = {
  kind: 'entity',
  bucket: 'crm_company',
  id: 'company-1',
  searchText: 'Acme',
  sortTimestamp: 0,
  timestamps: {},
  data: { type: 'crm_company', id: 'company-1', name: 'Acme' },
} as unknown as EntityItem<CrmCompanyEntity>;

const contact = {
  kind: 'entity',
  bucket: 'crm_contact',
  id: 'contact-1',
  searchText: 'Ada',
  sortTimestamp: 0,
  timestamps: {},
  data: {
    type: 'crm_contact',
    id: 'contact-1',
    name: '',
    email: 'ada@acme.com',
  },
} as unknown as EntityItem<CrmContactEntity>;

function handlerFor(
  blockName: Parameters<typeof createItemHandler>[0]['blockName']
) {
  const dispatchCommand = vi.fn();
  const onDocumentMention = vi.fn();
  const onEmailMention = vi.fn();
  const handler = createItemHandler({
    editor: { dispatchCommand } as unknown as LexicalEditor,
    blockId: 'doc-1',
    blockName,
    onDocumentMention,
    onEmailMention,
  });
  return { handler, dispatchCommand, onDocumentMention, onEmailMention };
}

describe('CRM mention selection', () => {
  beforeEach(() => {
    trackMention.mockReset();
  });

  it.each([
    [company, 'crm_company', 'company', 'Acme'],
    [contact, 'crm_contact', 'contact', 'ada@acme.com'],
  ] as const)(
    'records a %s chip as a reference of the CRM record without sharing anything',
    async (item, trackedType, blockName, documentName) => {
      trackMention.mockResolvedValue('mention-uuid');
      const { handler, dispatchCommand, onDocumentMention, onEmailMention } =
        handlerFor('md');
      await handler(item);

      expect(trackMention).toHaveBeenCalledWith(
        'doc-1',
        trackedType,
        item.data.id
      );
      expect(dispatchCommand).toHaveBeenNthCalledWith(2, 'insert-document', {
        documentId: item.data.id,
        documentName,
        blockName,
        mentionUuid: 'mention-uuid',
      });
      expect(onDocumentMention).not.toHaveBeenCalled();
      expect(onEmailMention).not.toHaveBeenCalled();
    }
  );

  it('leaves message editors to record CRM references when the message sends', async () => {
    const { handler, dispatchCommand } = handlerFor('channel');
    await handler(company);
    expect(trackMention).not.toHaveBeenCalled();
    expect(dispatchCommand).toHaveBeenNthCalledWith(2, 'insert-document', {
      documentId: 'company-1',
      documentName: 'Acme',
      blockName: 'company',
    });
  });
});
