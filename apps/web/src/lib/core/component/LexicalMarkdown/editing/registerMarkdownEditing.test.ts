import { createRoot } from 'solid-js';
import { createStore } from 'solid-js/store';
import { describe, expect, it, vi } from 'vitest';

type Tagged = ((...args: unknown[]) => () => void) & {
  tag: string;
  args: unknown[];
};

const factory = vi.hoisted(
  () =>
    (tag: string) =>
    (...args: unknown[]) =>
      Object.assign(() => () => {}, { tag, args })
);

vi.mock('@core/constant/isMac', () => ({ IS_MAC: false }));
vi.mock('@core/context/user', () => ({
  useUserId: () => () => 'macro|owner@example.com',
}));
vi.mock('@core/util/upload', () => ({ handleFileFolderDrop: vi.fn() }));
vi.mock('@macro-inc/lexical-core', () => ({
  AwaitNode: {},
  CommentNode: {},
  InlineSearchNode: {},
  peerIdPlugin: factory('peerId'),
}));
vi.mock('../plugins', () => ({
  awaitPlugin: factory('await'),
  createDraggableBlockStore: () => createStore({}),
  createDragInsertStore: () => createStore({ visible: false }),
  DefaultShortcuts: [],
  documentMetadataPlugin: factory('documentMetadata'),
  draggableBlockPlugin: factory('draggableBlock'),
  dragInsertPlugin: factory('dragInsert'),
  filePastePlugin: factory('filePaste'),
  horizontalRulePlugin: factory('horizontalRule'),
  keyboardShortcutsPlugin: factory('keyboardShortcuts'),
  listSwipeIndentPlugin: factory('listSwipeIndent'),
  listToTablePlugin: factory('listToTable'),
  markdownPastePlugin: factory('markdownPaste'),
  mentionsPlugin: factory('mentions'),
  selectionDataPlugin: factory('selectionData'),
  tabIndentationPlugin: factory('tabIndentation'),
  tableCellResizerPlugin: factory('tableCellResizer'),
  tablePlugin: factory('table'),
  tableTouchSelectionPlugin: factory('tableTouchSelection'),
  textPastePlugin: factory('textPaste'),
  trailingParagraphPlugin: factory('trailingParagraph'),
}));
vi.mock('../plugins/actions/actionsPlugin', () => ({
  actionsPlugin: factory('actions'),
}));
vi.mock('../plugins/block-decorator-navigation', () => ({
  blockDecoratorNavigationPlugin: factory('blockDecoratorNavigation'),
}));
vi.mock('../plugins/checkbox-to-task', () => ({
  CONVERT_CHECKBOXES_TO_TASKS: 'convert',
  checkboxToTaskPlugin: factory('checkboxToTask'),
}));
vi.mock('../plugins/checklist-controls', () => ({
  createChecklistControls: () => ({
    data: {},
    plugin: factory('checklistControls')(),
  }),
}));
vi.mock('../plugins/code/codePlugin', () => ({ codePlugin: factory('code') }));
vi.mock('../plugins/emojis/emojisPlugin', () => ({
  emojisPlugin: factory('emojis'),
}));
vi.mock('../plugins/ios-cursor-scroll', () => ({
  iosCursorScrollPlugin: factory('iosCursorScroll'),
}));
vi.mock('../plugins/media', () => ({ mediaPlugin: factory('media') }));
vi.mock('../plugins/node-accessory', () => ({
  createAccessoryStore: () => createStore({}),
}));
vi.mock('../plugins/normalize-enter/', () => ({
  normalizeEnterPlugin: factory('normalizeEnter'),
}));
vi.mock('../plugins/restore-focus', () => ({
  restoreFocusPlugin: factory('restoreFocus'),
}));
vi.mock('../plugins/snippets', () => ({ snippetsPlugin: factory('snippets') }));
vi.mock('../utils/fileUploadUtils', () => ({
  createFilesReadyHandler: vi.fn(),
  getDragDropPosition: vi.fn(),
}));

import { handleFileFolderDrop } from '@core/util/upload';
import type { LexicalWrapper } from '../context/LexicalWrapperContext';
import { createFilesReadyHandler } from '../utils/fileUploadUtils';
import {
  type MarkdownEditingOptions,
  registerMarkdownEditing,
} from './registerMarkdownEditing';

const slot = (tag: string) => factory(tag)();

function register(options: Partial<MarkdownEditingOptions> = {}) {
  const registered: Tagged[] = [];
  const plugins = {
    use(pluginFn: Tagged) {
      registered.push(pluginFn);
      return plugins;
    },
  };
  const lexicalWrapper = {
    editor: {},
    plugins,
  } as unknown as LexicalWrapper;
  const editing = createRoot(() =>
    registerMarkdownEditing({
      lexicalWrapper,
      isContentEditable: () => true,
      peerIdValidator: (() => true) as never,
      source: { id: 'doc-1', trackMentions: true },
      onVersionError: () => {},
      ...options,
    })
  );
  return { editing, registered, tags: () => registered.map((p) => p.tag) };
}

const SHARED_HEAD = [
  'tabIndentation',
  'listSwipeIndent',
  'selectionData',
  'horizontalRule',
  'emojis',
  'mentions',
];
const SHARED_MIDDLE = [
  'snippets',
  'actions',
  'media',
  'blockDecoratorNavigation',
  'table',
  'tableCellResizer',
  'tableTouchSelection',
  'filePaste',
];
const SHARED_TAIL = [
  'dragInsert',
  'textPaste',
  'restoreFocus',
  'markdownPaste',
  'normalizeEnter',
  'trailingParagraph',
  'checkboxToTask',
  'keyboardShortcuts',
  'documentMetadata',
];

describe('registerMarkdownEditing', () => {
  it('registers document features at their fixed points in the document editor order', () => {
    const { tags } = register({
      peerId: () => 'peer',
      iosScrollContainer: () => undefined,
      taskListControls: true,
      slots: {
        afterMentions: [slot('tags')],
        afterFilePaste: [slot('findAndReplace')],
        beforeAwait: [slot('pinnedProperties')],
        beforeCode: () => [slot('diff'), slot('generate')],
      },
    });
    expect(tags()).toEqual([
      ...SHARED_HEAD,
      'tags',
      ...SHARED_MIDDLE,
      'findAndReplace',
      ...SHARED_TAIL,
      'pinnedProperties',
      'await',
      'iosCursorScroll',
      'peerId',
      'diff',
      'generate',
      'code',
      'checklistControls',
      'listToTable',
    ]);
  });

  it('gives a surface the same editing features without document slots', () => {
    const { tags } = register({ peerId: () => 'peer' });
    expect(tags()).toEqual([
      ...SHARED_HEAD,
      ...SHARED_MIDDLE,
      ...SHARED_TAIL,
      'await',
      'peerId',
      'code',
      'listToTable',
    ]);
  });

  it('shares the code block accessories with the before-code slot', () => {
    const beforeCode = vi.fn(() => []);
    const { registered } = register({ slots: { beforeCode } });
    const [[accessories]] = beforeCode.mock.calls as unknown as [
      [[object, unknown]],
    ];
    const code = registered.find((p) => p.tag === 'code');
    expect(code?.args[0]).toMatchObject({
      accessories: accessories[0],
      setAccessories: accessories[1],
    });
  });

  it('tracks mentions and uploads only for document sources', () => {
    const tracked = register();
    const untracked = register({
      source: { id: 'surface-1', trackMentions: false },
    });
    const mentions = (r: ReturnType<typeof register>) =>
      r.registered.find((p) => p.tag === 'mentions')?.args[0];
    expect(mentions(tracked)).toMatchObject({
      sourceDocumentId: 'doc-1',
      disableMentionTracking: false,
    });
    expect(mentions(untracked)).toMatchObject({
      sourceDocumentId: 'surface-1',
      disableMentionTracking: true,
    });

    untracked.editing.dropFiles([], [], {} as DragEvent);
    tracked.editing.dropFiles([], [], {} as DragEvent, 'md');
    expect(handleFileFolderDrop).toHaveBeenCalledTimes(2);
    expect(vi.mocked(createFilesReadyHandler).mock.calls).toEqual([
      [{}, undefined, undefined, expect.any(Function)],
      [{}, 'doc-1', 'md', expect.any(Function)],
    ]);
  });

  it('tracks drags over the connected container', () => {
    const { editing, registered } = register();
    const container = document.createElement('div');
    editing.connectContainer(container);
    expect(registered.slice(-2).map((p) => [p.tag, p.args[0]])).toEqual([
      ['dragInsert', expect.objectContaining({ dragListenerRef: container })],
      ['draggableBlock', expect.objectContaining({ anchorElem: container })],
    ]);
  });

  it('reports open inline menus', () => {
    const { editing } = register();
    expect(editing.isInlineMenuOpen()).toBe(false);
    editing.menus.actions.setIsOpen(true);
    expect(editing.isInlineMenuOpen()).toBe(true);
  });
});
