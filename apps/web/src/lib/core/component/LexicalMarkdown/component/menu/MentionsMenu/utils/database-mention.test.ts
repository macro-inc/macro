import type { LexicalEditor } from 'lexical';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { trackMention } = vi.hoisted(() => ({ trackMention: vi.fn() }));
vi.mock('@core/signal/mention', () => ({ trackMention }));
vi.mock('@service-connection/websocket', () => ({
  ws: { send() {}, addEventListener() {}, removeEventListener() {} },
  state: () => 'closed',
  createConnectionBlockWebsocketEffect() {},
  createConnectionWebsocketEffect() {},
  parseWebsocketPayload: () => undefined,
}));
vi.mock('@service-storage/websocket', () => ({
  storageWS: { send() {}, addEventListener() {}, removeEventListener() {} },
  createWebSocketJob() {},
}));
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
import type { DatabaseEntity } from '@entity';
import { getBlockNameFromEntity } from './entityUtils';
import { createItemHandler } from './mentionHandlers';

const database: EntityItem<DatabaseEntity> = {
  kind: 'entity',
  bucket: 'database',
  sortTimestamp: 0,
  id: 'db-1',
  searchText: 'Party Planner',
  timestamps: { createdAt: new Date(), updatedAt: new Date() },
  data: {
    type: 'database',
    id: 'db-1',
    name: 'Party Planner',
    ownerId: 'macro|wolf@macro.com',
    grant: 'owner',
  },
};

describe('mentioning a database', () => {
  beforeEach(() => {
    trackMention.mockReset();
    trackMention.mockResolvedValue('mention-1');
  });

  it('opens as the database block', () => {
    expect(getBlockNameFromEntity(database)).toBe('database');
  });

  it('inserts a database mention and tracks it as a database', async () => {
    const dispatchCommand = vi.fn();
    const editor = { dispatchCommand } as unknown as LexicalEditor;
    const handle = createItemHandler({ editor, blockId: 'doc-1' });

    await handle(database);

    expect(trackMention).toHaveBeenCalledWith('doc-1', 'database', 'db-1');
    expect(dispatchCommand).toHaveBeenLastCalledWith('insert-document', {
      documentId: 'db-1',
      documentName: 'Party Planner',
      blockName: 'database',
      mentionUuid: 'mention-1',
      channelType: undefined,
    });
  });
});
