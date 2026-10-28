import {
  type MarkdownDocumentContextValue,
  MarkdownDocumentProvider,
} from '@block-md/context/markdown-document-context';
import { createMarkdownDocumentState } from '@block-md/context/markdown-document-state';
import {
  $createDocumentCardNode,
  $isDocumentCardNode,
  $isDocumentMentionNode,
} from '@macro-inc/lexical-core';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@solidjs/testing-library';
import { $getNodeByKey, $getRoot } from 'lexical';
import { createResource, type JSX, onCleanup } from 'solid-js';
import { createStore } from 'solid-js/store';
import { afterEach, expect, it, vi } from 'vitest';
import {
  createLexicalWrapper,
  LexicalWrapperContext,
} from '../../context/LexicalWrapperContext';
import { MarkdownHostContext } from '../../context/MarkdownHostContext';
import { defaultSelectionData } from '../../plugins/selection-data';
import { DocumentCard } from './DocumentCard';

// The card's imports reach the realtime connection, which opens a socket on load.
const mocks = vi.hoisted(() => {
  class FakeWebSocket {
    url: string;
    readyState = 1;
    constructor(url: string) {
      this.url = url;
    }
    close() {}
    addEventListener() {}
    removeEventListener() {}
    send() {}
  }
  vi.stubGlobal('WebSocket', FakeWebSocket);
  return {
    disposed: 0,
    created: [] as string[],
    read: undefined as (() => void) | undefined,
  };
});

vi.mock('@core/component/ItemPreview', () => ({
  useItemPreviewData: () => ({
    item: () => {
      mocks.read?.();
      return {
        id: 'form-1',
        name: 'Lunch?',
        type: 'form',
        loading: false,
        access: 'view',
      };
    },
    ItemEntityIcon: () => null,
    documentProperties: () => undefined,
  }),
}));
vi.mock('@queries/preview', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@queries/preview')>()),
  isAccessiblePreviewItem: () => true,
}));
vi.mock('@core/orchestrator', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@core/orchestrator')>()),
  createBlockInstance: (blockName: string, id: string) => {
    mocks.created.push(`${blockName} ${id}`);
    return {
      element: () => {
        onCleanup(() => {
          mocks.disposed += 1;
        });
        return <div data-nested-block={blockName}>{id}</div>;
      },
    };
  },
}));

// Menus render in place, so their items can be read and picked.
vi.mock('@ui', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@ui')>();
  const Dropdown = Object.assign(
    (props: { children?: JSX.Element }) => <div>{props.children}</div>,
    {
      Trigger: (props: { children?: JSX.Element; 'aria-label'?: string }) => (
        <button type="button" aria-label={props['aria-label']}>
          {props.children}
        </button>
      ),
      Content: (props: { children?: JSX.Element }) => (
        <div role="menu">{props.children}</div>
      ),
      Group: (props: { children?: JSX.Element }) => <div>{props.children}</div>,
      Item: (props: { children?: JSX.Element; onSelect?: () => void }) => (
        <div role="menuitem" onClick={() => props.onSelect?.()}>
          {props.children}
        </div>
      ),
    }
  );
  return { ...actual, Dropdown };
});

afterEach(() => {
  cleanup();
  mocks.read = undefined;
});

it('mounts a form card’s body in a channel message, with no block and no editor around it, and disposes it with the card', async () => {
  const { unmount } = render(() => (
    <MarkdownHostContext.Provider value="channel">
      <DocumentCard
        key="node-1"
        documentId="form-1"
        documentName="Lunch?"
        blockName="form"
        blockParams={{}}
        theme={{}}
      />
    </MarkdownHostContext.Provider>
  ));
  expect((await screen.findByText('form-1')).dataset.nestedBlock).toBe('form');
  expect(mocks.created).toEqual(['form form-1']);
  // A form fits its content: no fixed preview height, no resize grip.
  const card = screen.getByText('form-1').closest<HTMLElement>('.rounded-xl');
  expect(card?.style.height).toBe('auto');
  expect(card?.classList.contains('resize-y')).toBe(false);
  unmount();
  expect(mocks.disposed).toBe(1);
});

it('offers navigation on sent cards without collapse or editing actions', async () => {
  render(() => (
    <MarkdownHostContext.Provider value="channel">
      <DocumentCard
        key="node-1"
        documentId="form-1"
        documentName="Lunch?"
        blockName="form"
        blockParams={{}}
        theme={{}}
      />
    </MarkdownHostContext.Provider>
  ));
  await screen.findByText('form-1');
  expect(screen.queryByRole('menuitem', { name: /Collapse/ })).toBeNull();
  expect(screen.getByRole('menuitem', { name: 'Copy Link' })).toBeTruthy();
  expect(
    screen.getByRole('menuitem', { name: 'Open in New Split' })
  ).toBeTruthy();
  expect(screen.queryByRole('menuitem', { name: /Delete/ })).toBeNull();
  expect(
    screen.queryByRole('menuitem', { name: /Convert to Inline Mention/ })
  ).toBeNull();
  expect(screen.getByText('form-1')).toBeTruthy();
});

it('reserves a poll’s height across suspended metadata loading', async () => {
  let release: (() => void) | undefined;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  render(() => {
    const [ready] = createResource(() => pending);
    mocks.read = () => {
      ready();
    };
    return (
      <MarkdownHostContext.Provider value="channel">
        <DocumentCard
          key="poll-node"
          documentId="form-1"
          documentName="Lunch?"
          blockName="form"
          blockParams={{}}
          previewData={{ poll: { optionCount: 3 } }}
          theme={{}}
        />
      </MarkdownHostContext.Provider>
    );
  });
  const placeholder = await screen.findByRole('status');
  expect(
    placeholder.closest<HTMLElement>('[data-slot="card"]')?.style.height
  ).toBe('21.5rem');
  release?.();
  const content = await screen.findByText('form-1');
  expect(content.closest<HTMLElement>('.rounded-xl')?.style.height).toBe(
    '21.5rem'
  );
  expect(screen.queryByRole('status')).toBeNull();
});

it.each(['code', 'canvas', 'pdf'] as const)(
  'mounts a %s preview inside a standalone markdown document',
  async (blockName) => {
    const { unmount } = render(() => {
      const context: MarkdownDocumentContextValue = {
        documentId: () => 'document-1',
        kind: () => 'document',
        documentSource: () => ({ type: 'loading' }),
        permissions: {
          canComment: () => true,
          canEdit: () => true,
          isOwner: () => true,
        },
        persistedName: () => 'Embeds',
        fallbackName: () => 'Embeds',
        state: createMarkdownDocumentState(),
        element: () => undefined,
      };
      return (
        <MarkdownDocumentProvider context={context}>
          <DocumentCard
            key="embedded-node"
            documentId="form-1"
            documentName="Embedded document"
            blockName={blockName}
            blockParams={{}}
            theme={{}}
          />
        </MarkdownDocumentProvider>
      );
    });

    const content = await screen.findByText('form-1');
    expect(content.dataset.nestedBlock).toBe(blockName);
    expect(
      content
        .closest<HTMLElement>('.rounded-xl')
        ?.classList.contains('resize-y')
    ).toBe(true);
    const disposedBeforeUnmount = mocks.disposed;
    unmount();
    expect(mocks.disposed).toBe(disposedBeforeUnmount + 1);
  }
);

it.each(['code', 'canvas'] as const)(
  'keeps a native %s resize when selection changes and saves the new size',
  async (blockName) => {
    const wrapper = createLexicalWrapper({
      type: 'markdown',
      namespace: 'card-resize',
      isInteractable: () => true,
    });
    const [selection, setSelection] = createStore(
      structuredClone(defaultSelectionData)
    );
    const cardData = {
      documentId: 'form-1',
      documentName: 'Embedded document',
      blockName,
      blockParams: {},
      previewBox: ['100%', '400px'] as [string, string],
    };
    let key = '';
    wrapper.editor.update(
      () => {
        const node = $createDocumentCardNode(cardData);
        key = node.getKey();
        $getRoot().append(node);
      },
      { discrete: true }
    );
    render(() => {
      onCleanup(wrapper.cleanup);
      return (
        <MarkdownHostContext.Provider value="md">
          <LexicalWrapperContext.Provider value={{ ...wrapper, selection }}>
            <DocumentCard
              {...cardData}
              key={key}
              theme={{}}
              previewComponent={() => <div data-testid="resizable-preview" />}
            />
          </LexicalWrapperContext.Provider>
        </MarkdownHostContext.Provider>
      );
    });
    const card = screen
      .getByTestId('resizable-preview')
      .closest<HTMLElement>('.rounded-xl')!;
    vi.spyOn(card, 'getBoundingClientRect').mockImplementation(
      () => new DOMRect(0, 0, 768, Number.parseFloat(card.style.height))
    );

    // The native resize grip writes an inline height before mouseup selects
    // the card. That selection rerenders the card's class and style props.
    card.style.height = '560px';
    await Promise.resolve();
    setSelection({ type: 'node', nodeKeys: new Set([key]) });
    expect(card.style.height).toBe('560px');

    await waitFor(
      () => {
        const size = wrapper.editor.read(() => {
          const node = $getNodeByKey(key);
          return $isDocumentCardNode(node) ? node.getPreviewBox() : undefined;
        });
        expect(size).toEqual([768, 560]);
      },
      { timeout: 2000 }
    );
    expect(card.style.height).toBe('560px');
  }
);

it('shows convert back to mention when the editor becomes editable and preserves the reference', async () => {
  const wrapper = createLexicalWrapper({
    type: 'markdown',
    namespace: 'card-conversion',
    isInteractable: () => true,
  });
  const cardData = {
    documentId: 'form-1',
    documentName: 'Lunch?',
    blockName: 'form',
    blockParams: { question: 'lunch' },
  };
  let key = '';
  wrapper.editor.update(
    () => {
      const node = $createDocumentCardNode(cardData);
      key = node.getKey();
      $getRoot().append(node);
    },
    { discrete: true }
  );
  wrapper.editor.setEditable(false);
  render(() => {
    onCleanup(wrapper.cleanup);
    return (
      <LexicalWrapperContext.Provider value={wrapper}>
        <DocumentCard {...cardData} key={key} theme={{}} />
      </LexicalWrapperContext.Provider>
    );
  });
  expect(
    screen.queryByRole('menuitem', { name: 'Convert to Inline Mention' })
  ).toBeNull();
  wrapper.editor.setEditable(true);
  fireEvent.click(
    await screen.findByRole('menuitem', { name: 'Convert to Inline Mention' })
  );
  await waitFor(() => {
    wrapper.editor.read(() => {
      const mention = $getRoot().getFirstDescendant();
      expect($isDocumentMentionNode(mention)).toBe(true);
      if (!$isDocumentMentionNode(mention)) return;
      expect(mention?.getDocumentId()).toBe(cardData.documentId);
      expect(mention?.getBlockParams()).toEqual(cardData.blockParams);
      expect($getNodeByKey(key)).toBeNull();
    });
  });
});
