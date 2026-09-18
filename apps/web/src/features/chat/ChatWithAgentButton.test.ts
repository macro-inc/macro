import { createHeadlessEditor } from '@lexical/headless';
import {
  $convertFromMarkdownString,
  $convertToMarkdownString,
} from '@lexical/markdown';
import { SupportedNodeTypes } from '@macro-inc/lexical-core/node-list';
import { ALL_TRANSFORMERS } from '@macro-inc/lexical-core/transformers';
import { $getRoot } from 'lexical';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createChat: vi.fn(),
  openWithSplit: vi.fn(),
  storeChatStateImmediate: vi.fn(),
  setPendingSendData: vi.fn(),
}));

vi.mock('@app/signal/splitLayout', () => ({
  globalSplitManager: () => ({ openWithSplit: mocks.openWithSplit }),
}));
vi.mock('@core/component/AI/signal/pendingSend', () => ({
  setPendingSendData: mocks.setPendingSendData,
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
        '<m-document-mention>{"documentId":"document-id","documentName":"Project plan","blockName":"md","blockParams":{}}</m-document-mention> ',
      attachments: [{ entity_id: 'document-id', entity_type: 'document' }],
    });
    expect(mocks.openWithSplit).toHaveBeenCalledWith(
      { type: 'chat', id: 'chat-id' },
      { activate: true, preferNewSplit: true }
    );
  });

  it('attaches a spreadsheet with its current sheet and range without sending a message', async () => {
    const opened = await openChatWithAgent({
      type: 'document',
      id: 'sheet-id',
      name: 'Budget',
      fileType: 'spreadsheet',
      blockParams: {
        sheetId: 'sheet-2',
        sheetName: 'Annual budget',
        range: 'B4:E9',
      },
    });
    expect(opened).toBe(true);
    expect(mocks.storeChatStateImmediate).toHaveBeenCalledWith('chat-id', {
      input:
        '<m-document-mention>{"documentId":"sheet-id","documentName":"Budget","blockName":"spreadsheet","blockParams":{"sheetId":"sheet-2","sheetName":"Annual budget","range":"B4:E9"}}</m-document-mention> ',
      attachments: [{ entity_id: 'sheet-id', entity_type: 'document' }],
    });
    expect(mocks.setPendingSendData).not.toHaveBeenCalled();
    const input: string = mocks.storeChatStateImmediate.mock.calls[0][1].input;
    const editor = createHeadlessEditor({ nodes: SupportedNodeTypes });
    editor.update(() => $convertFromMarkdownString(input, ALL_TRANSFORMERS), {
      discrete: true,
    });
    editor.getEditorState().read(() => {
      const serialized = $convertToMarkdownString(ALL_TRANSFORMERS);
      expect(serialized).toContain(
        '"blockParams":{"sheetId":"sheet-2","sheetName":"Annual budget","range":"B4:E9"}'
      );
      expect($getRoot().getTextContent()).toBe('Budget ');
    });
  });

  it('does not open a split or lose the draft when chat creation fails', async () => {
    mocks.createChat.mockResolvedValueOnce({ error: 'Unavailable' });
    expect(
      await openChatWithAgent({
        type: 'document',
        id: 'sheet-id',
        name: 'Budget',
        fileType: 'spreadsheet',
      })
    ).toBe(false);
    expect(mocks.openWithSplit).not.toHaveBeenCalled();
    expect(mocks.storeChatStateImmediate).not.toHaveBeenCalled();
  });
});
