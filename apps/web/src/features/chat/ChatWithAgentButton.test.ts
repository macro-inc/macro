import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createChat: vi.fn(),
  openWithSplit: vi.fn(),
  storeChatStateImmediate: vi.fn(),
}));

vi.mock('@app/signal/splitLayout', () => ({
  globalSplitManager: () => ({ openWithSplit: mocks.openWithSplit }),
}));
vi.mock('@core/component/AI/signal/pendingSend', () => ({
  setPendingSendData: vi.fn(),
}));
vi.mock('@core/component/LexicalMarkdown/plugins/mentions', () => ({
  INSERT_DOCUMENT_MENTION_COMMAND: {},
}));
vi.mock('@core/component/AI/util/storage', () => ({
  storeChatStateImmediate: mocks.storeChatStateImmediate,
}));
vi.mock('@core/component/Toast/Toast', () => ({
  toast: { failure: vi.fn() },
}));
vi.mock('@core/constant/allBlocks', () => ({
  fileTypeToBlockName: (fileType: string | null | undefined) =>
    fileType ?? 'unknown',
}));
vi.mock('@core/util/create', () => ({
  createChat: mocks.createChat,
}));
vi.mock('@icon/wide-star', () => ({
  AnimatedStarIcon: () => null,
}));
vi.mock('@ui', () => ({
  Button: () => null,
}));

import { openChatWithAgent } from './ChatWithAgentButton';

describe('openChatWithAgent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createChat.mockResolvedValue({ chatId: 'chat-id' });
  });

  it('seeds and opens a new chat with a visible mention and attachment', async () => {
    await openChatWithAgent({
      type: 'document',
      id: 'document-id',
      name: 'Project plan',
      fileType: 'md',
    });

    expect(mocks.storeChatStateImmediate).toHaveBeenCalledWith('chat-id', {
      input:
        '<m-document-mention>{"documentId":"document-id","documentName":"Project plan","blockName":"md","blockParams":{}}</m-document-mention>',
      attachments: [{ entity_id: 'document-id', entity_type: 'document' }],
    });
    expect(mocks.openWithSplit).toHaveBeenCalledWith(
      { type: 'chat', id: 'chat-id' },
      { activate: true, preferNewSplit: true }
    );
  });
});
