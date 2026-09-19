import { cleanup, render } from '@solidjs/testing-library';
import { createContext, type JSX, useContext } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  readContext: undefined as (() => string) | undefined,
  seenContext: undefined as string | undefined,
  setPreviewComponent: vi.fn(),
  unsetPreviewCache: vi.fn(),
}));

vi.mock('@core/component/ItemPreview', () => ({
  useItemPreviewData: () => ({
    item: () => ({
      access: 'access',
      id: 'channel-id',
      loading: false,
      name: 'Channel',
    }),
    ItemEntityIcon: () => null,
    documentProperties: () => [],
  }),
}));
vi.mock('@core/component/Toast/Toast', () => ({
  toast: { success: vi.fn() },
}));
vi.mock('@core/constant/allBlocks', () => ({
  resolveBlockAlias: (name: string) => name,
  verifyBlockName: (name: string) => name,
}));
vi.mock('@core/constant/featureFlags', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  ENABLE_BLOCK_IN_BLOCK: false,
}));
vi.mock('@core/orchestrator', () => ({
  canNestBlock: () => false,
  createBlockInstance: vi.fn(),
}));
vi.mock('@core/signal/blockElement', () => ({
  blockElementSignal: { get: () => undefined },
}));
vi.mock('@core/user', () => ({
  getDisplayName: () => undefined,
  tryMacroId: () => undefined,
}));
vi.mock('@queries/preview', () => ({
  isAccessiblePreviewItem: () => true,
}));
vi.mock('@service-storage/client', () => ({
  blockNameToItemType: (name: string) => name,
}));
vi.mock('@solid-primitives/scheduled', () => ({
  debounce: (callback: (...args: unknown[]) => unknown) => callback,
}));
vi.mock('@ui', () => {
  const Passthrough = (props: { children?: JSX.Element }) => props.children;
  const Empty = () => null;
  return {
    Card: Object.assign(Passthrough, {
      Header: Passthrough,
      Body: Passthrough,
    }),
    Item: Object.assign(Passthrough, {
      Icon: Passthrough,
      Content: Passthrough,
      Title: Passthrough,
      Description: Passthrough,
      Actions: Passthrough,
    }),
    Dropdown: Object.assign(Passthrough, {
      Trigger: Empty,
      Content: Empty,
      Group: Passthrough,
      Item: Passthrough,
    }),
    cn: (...values: unknown[]) => values.filter(Boolean).join(' '),
  };
});
vi.mock('lexical', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  $getNodeByKey: () => ({}),
}));
vi.mock('@macro-inc/lexical-core', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  $getId: () => 'preview-node-id',
  setDocumentCardPreviewComponent: mocks.setPreviewComponent,
  unsetDocumentCardPreviewCache: mocks.unsetPreviewCache,
}));
vi.mock('../../plugins', () => ({
  UPDATE_DOCUMENT_NAME_COMMAND: Symbol('update-document-name'),
  createPluginManager: vi.fn(),
  insertTextPlugin: vi.fn(),
  nodeTransformPlugin: vi.fn(),
}));
vi.mock('../../../TaskPropertiesPreview', () => ({
  TaskPropertiesPreview: () => null,
  TaskPropertiesPreviewProvider: (props: { children?: JSX.Element }) =>
    props.children,
}));
vi.mock('../core/BlockLink', () => ({
  BlockLink: (props: { children?: JSX.Element }) => props.children,
}));
vi.mock('./ChannelMessageThreadCard', () => ({
  ChannelMessageThreadCard: () => {
    mocks.seenContext = mocks.readContext?.();
    return null;
  },
}));

import {
  type LexicalWrapper,
  LexicalWrapperContext,
} from '../../context/LexicalWrapperContext';
import { DocumentCard } from './DocumentCard';

const PreviewContext = createContext('missing');

beforeEach(() => {
  mocks.readContext = () => useContext(PreviewContext);
  mocks.seenContext = undefined;
  vi.clearAllMocks();
});

afterEach(cleanup);

describe('DocumentCard preview ownership', () => {
  it('inherits the current owner when rendered outside a Block', () => {
    const editor = {
      dispatchCommand: vi.fn(),
      isEditable: () => true,
      read: <T,>(callback: () => T) => callback(),
      update: (callback: () => void) => callback(),
    };
    const wrapper = {
      cleanup: () => {},
      editor,
      isInteractable: () => true,
      plugins: {},
      type: 'markdown',
    } as unknown as LexicalWrapper;

    render(() => (
      <PreviewContext.Provider value="inherited">
        <LexicalWrapperContext.Provider value={wrapper}>
          <DocumentCard
            blockName="channel"
            blockParams={{ channel_message_id: 'message-id' }}
            documentId="channel-id"
            documentName="Channel"
            key="node-key"
            theme={{}}
          />
        </LexicalWrapperContext.Provider>
      </PreviewContext.Provider>
    ));

    expect(mocks.setPreviewComponent).toHaveBeenCalledWith(
      'preview-node-id',
      expect.any(Function),
      expect.any(Function)
    );
    expect(mocks.seenContext).toBe('inherited');
  });
});
