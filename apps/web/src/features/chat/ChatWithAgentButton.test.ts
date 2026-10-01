import type { SplitHandle } from '@components/app/split-layout/layoutManager';
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
  startPendingSession: vi.fn(),
  manager: true,
  failure: vi.fn(),
  openWithSplit: vi.fn(),
}));

vi.mock('@app/signal/splitLayout', () => ({
  globalSplitManager: () =>
    mocks.manager ? { openWithSplit: mocks.openWithSplit } : undefined,
}));
vi.mock('@app/features/block-agent/context/pending-session', () => ({
  startPendingSession: mocks.startPendingSession,
}));
vi.mock('@core/component/LexicalMarkdown/plugins/mentions', () => ({
  INSERT_DOCUMENT_MENTION_COMMAND: {},
}));
vi.mock('@core/component/Toast/Toast', () => ({
  toast: { failure: mocks.failure },
}));
vi.mock('@core/constant/allBlocks', () => ({
  fileTypeToBlockName: (fileType: string | null | undefined) =>
    fileType ?? 'unknown',
}));
vi.mock('@ui', () => ({
  Button: () => null,
}));

import {
  openChatWithAgent,
  openChatWithInput,
  openChatWithInputReplacingSplit,
  openChatWithMessage,
  openChatWithMessageReplacingSplit,
} from './ChatWithAgentButton';

describe('openChatWithAgent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.startPendingSession.mockReturnValue('session-id');
    mocks.manager = true;
  });

  it('opens an agent session with an unsent visible mention', async () => {
    await openChatWithAgent({
      type: 'document',
      id: 'document-id',
      name: 'Project plan',
      fileType: 'md',
    });

    expect(mocks.startPendingSession).toHaveBeenCalledWith({
      prompt: undefined,
      initialInput:
        '<m-document-mention>{"documentId":"document-id","documentName":"Project plan","blockName":"md","blockParams":{}}</m-document-mention> ',
    });
    expect(mocks.openWithSplit).toHaveBeenCalledWith(
      { type: 'component', id: 'agents-session~agents~session-id' },
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
    expect(mocks.startPendingSession).toHaveBeenCalledWith({
      prompt: undefined,
      initialInput:
        '<m-document-mention>{"documentId":"sheet-id","documentName":"Budget","blockName":"spreadsheet","blockParams":{"sheetId":"sheet-2","sheetName":"Annual budget","range":"B4:E9"}}</m-document-mention> ',
    });
    const input: string =
      mocks.startPendingSession.mock.calls[0][0].initialInput;
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

  it('does not start a session when navigation is unavailable', async () => {
    mocks.manager = false;
    expect(
      await openChatWithAgent({
        type: 'document',
        id: 'sheet-id',
        name: 'Budget',
        fileType: 'spreadsheet',
      })
    ).toBe(false);
    expect(mocks.openWithSplit).not.toHaveBeenCalled();
    expect(mocks.startPendingSession).not.toHaveBeenCalled();
    expect(mocks.failure).toHaveBeenCalledWith('Unable to open chat');
  });
  it.each([
    { type: 'email' as const, id: 'email-id', name: 'Subject' },
    { type: 'project' as const, id: 'project-id', name: 'Launch' },
    {
      type: 'channel' as const,
      id: 'channel-id',
      name: 'Team',
      channelType: 'public' as const,
    },
  ])('preserves context for $type actions', async (entity) => {
    await openChatWithAgent(entity);
    const seed = mocks.startPendingSession.mock.calls[0][0];
    expect(seed.prompt).toBeUndefined();
    expect(seed.initialInput).toContain(entity.id);
    expect(seed.initialInput).toContain(entity.name);
    if (entity.type === 'channel')
      expect(seed.initialInput).toContain('"channelType":"public"');
  });

  it('hands a submitted query to the agent as the first prompt', async () => {
    await openChatWithMessage('Find my latest invoices');
    expect(mocks.startPendingSession).toHaveBeenCalledWith({
      prompt: 'Find my latest invoices',
      initialInput: undefined,
    });
    expect(mocks.openWithSplit).toHaveBeenCalledWith(
      { type: 'component', id: 'agents-session~agents~session-id' },
      { activate: true, preferNewSplit: true }
    );
  });

  it('preserves a channel-message draft without sending it', async () => {
    await openChatWithInput('A message reference\n\n');
    expect(mocks.startPendingSession).toHaveBeenCalledWith({
      prompt: undefined,
      initialInput: 'A message reference\n\n',
    });
  });

  it.each(['Find invoices', ''])(
    'replaces the search split for query %j',
    async (query) => {
      mocks.manager = false;
      const replace = vi.fn();
      const split = { replace } as unknown as SplitHandle;
      if (query) await openChatWithMessageReplacingSplit(query, split);
      else await openChatWithInputReplacingSplit('', split);
      expect(mocks.startPendingSession).toHaveBeenCalledWith({
        prompt: query || undefined,
        initialInput: query ? undefined : '',
      });
      expect(replace).toHaveBeenCalledWith({
        next: { type: 'component', id: 'agents-session~agents~session-id' },
      });
      expect(mocks.openWithSplit).not.toHaveBeenCalled();
    }
  );
});
