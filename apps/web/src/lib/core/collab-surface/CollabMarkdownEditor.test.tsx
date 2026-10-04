import { cleanup, render } from '@solidjs/testing-library';
import { afterEach, expect, it, vi } from 'vitest';

const fakes = vi.hoisted(() => {
  const plugins: Record<string, unknown> = {};
  for (const step of [
    'richText',
    'list',
    'markdownShortcuts',
    'delete',
    'state',
    'history',
    'use',
  ]) {
    plugins[step] = () => plugins;
  }
  return {
    plugins,
    editing: {
      dragInsert: [{ visible: false }, () => {}],
      isInlineMenuOpen: () => false,
      connectContainer: vi.fn(),
      dropFiles: vi.fn(),
    },
    overlays: [] as Array<Record<string, unknown>>,
  };
});

vi.mock('@core/component/LexicalMarkdown/collaboration/CollabProvider', () => ({
  CollabProvider: () => null,
}));
vi.mock('@core/component/LexicalMarkdown/constants', () => ({
  getErrorDescription: () => '',
}));
vi.mock(
  '@core/component/LexicalMarkdown/context/LexicalWrapperContext',
  async () => {
    const { createContext } = await import('solid-js');
    return {
      LexicalWrapperContext: createContext(),
      createLexicalWrapper: () => ({
        editor: {
          _config: { namespace: 'collab-surface' },
          focus: () => {},
          registerUpdateListener: () => () => {},
          setEditable: () => {},
          setRootElement: () => {},
        },
        plugins: fakes.plugins,
        cleanup: () => {},
        mapping: {},
      }),
    };
  }
);
vi.mock('@core/component/LexicalMarkdown/editing/entityDrop', () => ({
  useEditorEntityDrop: () => () => {},
}));
vi.mock(
  '@core/component/LexicalMarkdown/editing/MarkdownEditingOverlays',
  () => ({
    MarkdownEditingOverlays: (props: Record<string, unknown>) => {
      fakes.overlays.push(props);
      return null;
    },
  })
);
vi.mock(
  '@core/component/LexicalMarkdown/editing/registerMarkdownEditing',
  () => ({ registerMarkdownEditing: vi.fn(() => fakes.editing) })
);
vi.mock('@core/component/LexicalMarkdown/utils', () => ({
  editorFocusSignal: () => {},
  editorIsEmpty: () => true,
  initializeEditorEmpty: () => {},
}));
vi.mock('@core/directive/fileFolderDrop', () => ({ fileFolderDrop: () => {} }));
vi.mock('@macro-inc/lexical-core', () => ({
  createPeerIdValidator: () => () => true,
}));
vi.mock('@solid-primitives/lifecycle', () => ({
  onElementConnect: (_el: Element, connect: () => void) => connect(),
}));

import { registerMarkdownEditing } from '@core/component/LexicalMarkdown/editing/registerMarkdownEditing';
import { CollabMarkdownEditor } from './CollabMarkdownEditor';
import type { CollabMarkdownSession } from './types';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  fakes.overlays.length = 0;
});

const session = {
  loroManager: { peerIdStr: 'peer-1' },
  syncSource: () => undefined,
  connectionError: () => undefined,
} as unknown as CollabMarkdownSession;

it('gives a collaborative surface the document editing features without tracked mentions', () => {
  const view = render(() => (
    <CollabMarkdownEditor
      sourceId="project-1"
      session={session}
      label="Project description"
    />
  ));

  expect(registerMarkdownEditing).toHaveBeenCalledTimes(1);
  const [options] = vi.mocked(registerMarkdownEditing).mock.calls[0];
  expect(options.source).toEqual({
    id: 'project-1',
    blockName: undefined,
    trackMentions: false,
  });
  expect(options.peerId?.()).toBe('peer-1');

  expect(fakes.overlays).toHaveLength(1);
  const overlays = fakes.overlays[0] as {
    source: unknown;
    useBlockBoundary: boolean;
    canEdit: () => boolean;
  };
  expect(overlays.source).toBe(options.source);
  expect(overlays.useBlockBoundary).toBe(true);
  expect(overlays.canEdit()).toBe(true);

  const content = view.getByRole('textbox', { name: 'Project description' });
  expect(content.classList.contains('ph-no-capture')).toBe(true);
  expect(fakes.editing.connectContainer).toHaveBeenCalledWith(
    content.parentElement
  );
});
