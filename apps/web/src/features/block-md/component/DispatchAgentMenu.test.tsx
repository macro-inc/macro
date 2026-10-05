import { render } from '@solidjs/testing-library';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useDispatchAgentAction } from './DispatchAgentMenu';

const mocks = vi.hoisted(() => ({
  kind: 'document',
  shortId: vi.fn(),
  branchName: vi.fn(),
  threads: vi.fn(),
  copy: vi.fn(),
  success: vi.fn(),
  failure: vi.fn(),
}));
vi.mock('@app/features/integrations/mcp-setup/MacroMcpSetupModal', () => ({
  openMacroMcpSetupModal: vi.fn(),
}));
vi.mock('@core/component/LexicalMarkdown/utils', () => ({
  editorStateAsMarkdown: () => 'Document body',
}));
vi.mock('@core/component/Toast/Toast', () => ({
  toast: { success: mocks.success, failure: mocks.failure },
}));
vi.mock('@core/user', () => ({
  tryMacroId: () => undefined,
  macroIdToEmail: (id: string) => id,
}));
vi.mock('@core/util/branchName', () => ({
  copyBranchNameToClipboard: vi.fn(),
}));
vi.mock('@queries/messages/document-messages', () => ({
  fetchDocumentThreads: mocks.threads,
}));
vi.mock('@service-storage/client', () => ({
  storageServiceClient: {
    getDocumentShortId: mocks.shortId,
    getDocumentBranchName: mocks.branchName,
  },
}));
vi.mock('../context/markdown-document-context', () => ({
  useMarkdownDocument: () => ({
    documentId: () => 'document-id',
    kind: () => mocks.kind,
    state: { editor: { md: { editor: {} } } },
  }),
}));
vi.mock('./MarkdownNameProvider', () => ({
  useMarkdownName: () => ({ displayName: () => 'Example' }),
}));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.kind = 'document';
  mocks.shortId.mockResolvedValue({ isOk: () => true, value: 'DOC-1' });
  mocks.branchName.mockResolvedValue({
    isOk: () => true,
    value: { shortId: 'TASK-1', branchName: 'work/example' },
  });
  mocks.threads.mockResolvedValue([]);
  mocks.copy.mockResolvedValue(undefined);
  vi.stubGlobal('navigator', { clipboard: { writeText: mocks.copy } });
});
afterEach(() => vi.unstubAllGlobals());

function actions() {
  let result!: ReturnType<typeof useDispatchAgentAction>;
  const view = render(() => {
    result = useDispatchAgentAction();
    return null;
  });
  return { result, dispose: view.unmount };
}

it('copies document context without asking for a task branch or showing a success toast', async () => {
  const { result, dispose } = actions();
  expect(await result.executeLastUsed()).toBe(true);
  expect(mocks.copy).toHaveBeenCalledWith(
    expect.stringContaining('<document identifier="DOC-1">')
  );
  expect(mocks.copy).toHaveBeenCalledWith(
    expect.stringContaining('Document body')
  );
  expect(mocks.branchName).not.toHaveBeenCalled();
  expect(mocks.success).not.toHaveBeenCalled();
  dispose();
});

it('keeps task branch context and toast feedback for menu actions', async () => {
  mocks.kind = 'task';
  const { result, dispose } = actions();
  expect(await result.executeAction(result.lastUsed())).toBe(true);
  expect(mocks.copy).toHaveBeenCalledWith(
    expect.stringContaining('<branch>work/example</branch>')
  );
  expect(mocks.shortId).not.toHaveBeenCalled();
  expect(mocks.success).toHaveBeenCalledOnce();
  dispose();
});

it('reports clipboard failure instead of triggering copy success feedback', async () => {
  mocks.copy.mockRejectedValueOnce(new Error('Clipboard denied'));
  const error = vi.spyOn(console, 'error').mockImplementation(() => {});
  const { result, dispose } = actions();
  expect(await result.executeLastUsed()).toBe(false);
  expect(mocks.failure).toHaveBeenCalledWith('Failed to generate prompt');
  expect(mocks.success).not.toHaveBeenCalled();
  dispose();
  error.mockRestore();
});
