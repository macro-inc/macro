import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@solidjs/testing-library';
import type { ParentProps } from 'solid-js';
import { afterEach, expect, it, vi } from 'vitest';
import Block from './Block';

const upload = vi.hoisted(() => ({
  files: vi.fn().mockResolvedValue([]),
}));

vi.mock('@app/features/next-soup/actions', () => ({
  useBlockEntityCommands: () => {},
}));
vi.mock('@app/features/next-soup/create-soup-state', () => ({
  createSoupState: () => ({}),
}));
vi.mock('@app/features/next-soup/filters/filter-store', () => ({
  defineQueryFilters: () => ({}),
}));
vi.mock('@app/features/next-soup/filters/query-filters', () => ({
  soupItemMatchesProjectMembership: () => true,
}));
vi.mock('@app/features/next-soup/soup-context', () => ({
  SoupContextProvider: (props: ParentProps) => props.children,
}));
vi.mock('@app/features/next-soup/soup-view/soup-view-context', () => ({
  SoupViewContextProvider: (props: ParentProps) => props.children,
}));
vi.mock('@app/features/next-soup/soup-view/soup-view', async () => {
  const { SoupViewFileDropzone } = await import(
    '@app/features/next-soup/soup-view/soup-view-file-dropzone'
  );
  return {
    SoupViewList: (props: { uploadProjectId?: string }) => (
      <SoupViewFileDropzone projectId={props.uploadProjectId}>
        <div data-testid="folder-list">Folder contents</div>
      </SoupViewFileDropzone>
    ),
  };
});
vi.mock('@components/app/side-panel', () => ({
  SidePanel: { Layout: (props: ParentProps) => props.children },
}));
vi.mock('@components/app/split-layout/layout', () => ({
  useSplitLayout: () => ({}),
}));
vi.mock('@core/block', () => ({ useBlockId: () => 'new-folder' }));
vi.mock('@core/component/DocumentBlockContainer', () => ({
  DocumentBlockContainer: (props: ParentProps) => props.children,
}));
vi.mock('@core/component/FileDropOverlay', () => ({
  FileDropOverlay: (props: ParentProps) => props.children,
}));
vi.mock('@core/component/Toast/Toast', () => ({ toast: {} }));
vi.mock('@core/constant/allBlocks', () => ({
  fileTypeToBlockName: () => 'unknown',
}));
vi.mock('@core/directive/fileSelector', () => ({ fileSelector: () => {} }));
vi.mock('@core/signal/blockElement', () => ({
  blockHotkeyScopeSignal: { get: () => 'folder-scope' },
}));
vi.mock('@core/util/upload', () => ({
  uploadFiles: upload.files,
  handleFileFolderDrop: async (
    entries: FileSystemFileEntry[],
    _folders: FileSystemDirectoryEntry[],
    onFilesReady: (files: File[]) => Promise<void>
  ) => {
    const files = await Promise.all(
      entries.map(
        (entry) => new Promise<File>((resolve) => entry.file(resolve))
      )
    );
    await onFilesReady(files);
  },
}));
vi.mock('@queries/history/history', () => ({ refetchHistory: () => {} }));
vi.mock('@queries/soup/cache', () => ({ refetchSoupEntity: () => {} }));
vi.mock('@service-storage/util/refetchResources', () => ({
  refetchResources: () => {},
}));
vi.mock('./project-scoped-panel', () => ({
  useProjectScopedPanel: () => ({}),
}));
vi.mock('./sidepanel/ProjectSidePanelSections', () => ({
  ProjectSidePanelSections: () => null,
}));
vi.mock('./TopBar', () => ({ TopBar: () => null }));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

it.each([1, 2])(
  'uploads %i dropped computer files into the open folder',
  async (count) => {
    render(() => <Block />);
    const files = Array.from(
      { length: count },
      (_, index) =>
        new File(['contents'], `file-${index}.txt`, { type: 'text/plain' })
    );

    fireEvent.drop(screen.getByTestId('folder-list'), {
      dataTransfer: { items: [], files, types: ['Files'] },
    });

    await waitFor(() =>
      expect(upload.files).toHaveBeenCalledExactlyOnceWith(files, 'dss', {
        projectId: 'new-folder',
      })
    );
  }
);
