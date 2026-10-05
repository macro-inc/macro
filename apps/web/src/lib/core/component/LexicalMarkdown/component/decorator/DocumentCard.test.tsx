import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { type JSX, onCleanup } from 'solid-js';
import { afterEach, expect, it, vi } from 'vitest';
import { MarkdownHostContext } from '../../context/MarkdownHostContext';
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
  return { disposed: 0, created: [] as string[] };
});

vi.mock('@core/component/ItemPreview', () => ({
  useItemPreviewData: () => ({
    item: () => ({
      id: 'form-1',
      name: 'Lunch?',
      type: 'form',
      loading: false,
      access: 'view',
    }),
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

afterEach(cleanup);

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

it('offers a sent card only what works without an editor: collapsing it here, never deleting it from the message', async () => {
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
  expect(screen.getByRole('menuitem', { name: 'Collapse' })).toBeTruthy();
  expect(screen.queryByRole('menuitem', { name: /Delete/ })).toBeNull();
  expect(
    screen.queryByRole('menuitem', { name: /Convert to Inline Mention/ })
  ).toBeNull();
  fireEvent.click(screen.getByRole('menuitem', { name: 'Collapse' }));
  expect(screen.queryByText('form-1')).toBeNull();
});
