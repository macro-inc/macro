import { cleanup, fireEvent, render, waitFor } from '@solidjs/testing-library';
import type { ParentProps } from 'solid-js';
import { afterEach, expect, it, vi } from 'vitest';
import type { FolderSubmission } from './core/folder-composer';

const host = vi.hoisted(() => ({
  close: vi.fn(),
  popoverSplit: vi.fn(),
  openWithSplit: vi.fn(),
  success: vi.fn(),
  failure: vi.fn(),
  submission: undefined as FolderSubmission | undefined,
}));
vi.mock('@components/app/split-layout/layout', () => ({
  useSplitLayout: () => host,
}));
vi.mock('@components/app/split-layout/layoutUtils', () => ({
  useSplitPanelOrThrow: () => ({
    handle: {
      close: host.close,
      isPopover: () => true,
      setDisplayName: vi.fn(),
    },
  }),
}));
vi.mock('@components/app/split-panel', () => ({
  SplitPanel: {
    Root: (props: ParentProps) => props.children,
    Body: (props: ParentProps) => props.children,
  },
}));
vi.mock('@core/component/Toast/Toast', () => ({
  toast: { success: host.success, failure: host.failure },
}));
vi.mock('./queries/folder-creation', () => ({
  createFolderCommands: () => ({}),
}));
vi.mock('./views/create-folder', () => ({
  CreateFolder: (props: { onSubmit(submission: FolderSubmission): void }) => (
    <button onClick={() => props.onSubmit(host.submission!)}>Confirm</button>
  ),
}));

import { FolderComposeView } from './folder-compose-view';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function submit() {
  const completion =
    Promise.withResolvers<Awaited<FolderSubmission['result']>>();
  host.submission = { result: completion.promise };
  const view = render(() => (
    <FolderComposeView parentId="parent" destination="Design" source="drive" />
  ));
  fireEvent.click(view.getByRole('button', { name: 'Confirm' }));
  expect(host.close).toHaveBeenCalledOnce();
  expect(host.success).not.toHaveBeenCalled();
  view.unmount();
  return completion;
}

it('closes before the result and never closes a later composer when the upload completes', async () => {
  const completion = submit();
  completion.resolve({ type: 'created', id: 'folder', name: 'Assets' });
  await waitFor(() => expect(host.success).toHaveBeenCalledOnce());
  expect(host.close).toHaveBeenCalledOnce();
  expect(host.openWithSplit).not.toHaveBeenCalled();
});

it('offers retry after failure with the original destination and unfinished draft', async () => {
  const completion = submit();
  const draft = {
    name: 'Assets',
    tags: { tags: ['blue'] },
    files: [{ file: new File(['test'], 'brief.txt'), isFolder: false }],
    createdId: 'folder',
    error: 'Upload failed',
  };
  completion.resolve({ type: 'failed', draft });
  await waitFor(() => expect(host.failure).toHaveBeenCalledOnce());
  expect(host.popoverSplit).not.toHaveBeenCalled();
  host.failure.mock.calls[0][1].actions[0].onClick();
  expect(host.popoverSplit).toHaveBeenCalledWith({
    type: 'component',
    id: 'folder-compose',
    params: {
      parentId: 'parent',
      destination: 'Design',
      source: 'drive',
      initialDraft: draft,
    },
  });
});
