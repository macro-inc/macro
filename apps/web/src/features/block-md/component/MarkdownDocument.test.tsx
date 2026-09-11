import { render, screen } from '@solidjs/testing-library';
import type { ParentProps } from 'solid-js';
import { expect, it, vi } from 'vitest';
import type { MarkdownDocumentProps } from '../context/markdown-document-context';
import { MarkdownDocument } from './MarkdownDocument';

vi.hoisted(() => {
  const values = new Map<string, string>();
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
      clear: () => values.clear(),
    },
  });
});

vi.mock('../history/HistoryContext', () => ({
  HistoryProvider: (props: ParentProps) => props.children,
}));

vi.mock('@components/app/side-panel', () => ({
  SidePanel: {
    Layout: (props: ParentProps) => props.children,
  },
}));

vi.mock('@notifications', () => ({
  DocumentDebouncedNotificationReadMarker: () => null,
}));

vi.mock('@service-connection/websocket', () => ({
  createConnectionWebsocketEffect: () => {},
  ws: {
    addEventListener: () => {},
    removeEventListener: () => {},
    send: () => {},
  },
}));

vi.mock('@ui', () => ({
  Scroll: (props: ParentProps) => props.children,
}));

vi.mock('./FindAndReplace', () => ({
  FindAndReplace: () => null,
}));

vi.mock('./Notebook', () => ({
  Notebook: () => <div data-testid="markdown-notebook" />,
  InstructionsNotebook: () => <div data-testid="instructions-notebook" />,
}));

vi.mock('@macro-inc/collaboration/collab/manager', () => ({
  createLoroManager: () => ({
    doc: {},
    ingest: vi.fn(),
  }),
}));

vi.mock('@macro-inc/collaboration/collab/snapshot-store', () => ({
  IDBSnapshotStore: class {},
  LORO_SNAPSHOT_DB_NAME: 'test-snapshots',
}));

vi.mock('@macro-inc/collaboration/collab/wal', () => ({
  BrowserWALStore: class {},
  LORO_WAL_DB_NAME: 'test-wal',
}));

function createProps(
  documentId: string,
  isInstructions = false
): MarkdownDocumentProps {
  return {
    documentId,
    kind: 'document',
    data: () => undefined,
    source: () => undefined,
    permissions: {
      canComment: () => true,
      canEdit: () => true,
      isOwner: () => true,
    },
    persistedName: () => 'Free-floating note',
    fallbackName: () => 'New Note',
    isInstructions: () => isInstructions,
    saveDocument: vi.fn(),
    renameDocument: vi.fn(),
  };
}

it('mounts a reusable document without Block context', () => {
  render(() => <MarkdownDocument {...createProps('free-note')} />);

  expect(screen.getByTestId('markdown-notebook')).toBeTruthy();
});

it('selects the instructions document from explicit props', () => {
  render(() => <MarkdownDocument {...createProps('instructions', true)} />);

  expect(screen.getByTestId('instructions-notebook')).toBeTruthy();
});
