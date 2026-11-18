/** @vitest-environment jsdom */
import { cleanup, render } from '@solidjs/testing-library';
import type { ParentProps } from 'solid-js';
import { afterEach, expect, test, vi } from 'vitest';

const passthrough = (props: ParentProps) => props.children;
vi.mock('@core/document-session/engine-selection', () => ({
  RUST_EDITOR_ENGINE: false,
}));
vi.mock('@app/observability/flow', () => ({
  TraceFlow: passthrough,
  useFlow: () => ({ span: undefined }),
}));
vi.mock('@components/app/split-layout/split-router/mention-links', () => ({
  useMacroMentionLinkResolver: () => undefined,
}));
vi.mock('@macro-inc/collaboration/collab/manager', () => ({
  createLoroManager: () => ({}),
}));
vi.mock('@macro-inc/collaboration/collab/snapshot-store', () => ({
  IDBSnapshotStore: class {},
  LORO_SNAPSHOT_DB_NAME: 'snapshots',
}));
vi.mock('@macro-inc/collaboration/collab/wal', () => ({
  BrowserWALStore: class {},
  LORO_WAL_DB_NAME: 'wal',
}));
vi.mock('@ui', () => ({ Scroll: passthrough }));
vi.mock('../context/markdown-document-context', () => ({
  useMarkdownDocument: () => ({
    documentId: () => 'document-1',
    documentSource: () => ({ type: 'loading' }),
    state: { editor: { setMd: () => {} } },
  }),
}));
vi.mock('../history/HistoryContext', () => ({ HistoryProvider: passthrough }));
vi.mock('../history/HistoryWorkspace', () => ({
  HistoryWorkspace: () => null,
}));
vi.mock('./MarkdownEditor', () => ({ MarkdownEditor: () => null }));
vi.mock('./MarkdownNameProvider', () => ({
  MarkdownNameProvider: passthrough,
}));
vi.mock('./Notebook', () => ({
  Notebook: () => <div data-test-notebook />,
}));
vi.mock('./SessionMarkdownEditor', () => ({ default: () => null }));

const { MarkdownDocumentContent } = await import('./MarkdownDocument');

afterEach(cleanup);

// Main mounted the notebook (title, skeleton, inline properties) before the
// document's source resolved; with the native engine off it still does.
test('the flag-OFF markdown body mounts its notebook while the source loads', () => {
  const rendered = render(() => <MarkdownDocumentContent />);
  expect(rendered.container.querySelector('[data-test-notebook]')).not.toBe(
    null
  );
});
