import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@solidjs/testing-library';
import { createSignal, Show } from 'solid-js';
import { afterEach, expect, it, vi } from 'vitest';
import type { FolderSubmission } from '../core/folder-composer';
import { CreateFolder } from './create-folder';

const pickers = vi.hoisted(() => ({
  files: vi.fn(),
  folder: vi.fn(),
  prepareFolder: vi.fn(),
}));

// Native pickers and the shared query-backed tag widget are tested separately.
vi.mock('@core/util/upload', () => ({
  openFilePicker: pickers.files,
  openFolderPicker: pickers.folder,
  handleFolderSelect: pickers.prepareFolder,
  handleFileFolderDrop: vi.fn(),
}));
vi.mock('@property/tags', () => ({
  useLocalDocTags: (
    _read: unknown,
    save: (definition: { id: string }, ids: string[]) => void
  ) => ({
    select: () => save({ id: 'tags' }, ['blue']),
  }),
  InlineTagsPill: (props: { docTags: { select(): void } }) => (
    <button type="button" onClick={props.docTags.select}>
      Add tags
    </button>
  ),
}));

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

it('stages files and nested folders with tags, removes items, and submits to the created folder', async () => {
  const file = new File(['brief'], 'brief.txt');
  const nested = { file: new File(['zip'], 'Assets.zip'), isFolder: true };
  pickers.files.mockImplementation((_options, select) => select([file]));
  pickers.folder.mockImplementation((_options, select) => select([file]));
  pickers.prepareFolder.mockImplementation(async (_files, ready) =>
    ready([nested])
  );
  const commands = {
    create: vi.fn(async () => 'folder-id'),
    saveTags: vi.fn(async () => {}),
    upload: vi.fn(async () => {}),
  };
  const onSubmit = vi.fn();
  render(() => (
    <CreateFolder
      commands={commands}
      destination="Design"
      onClose={() => {}}
      onSubmit={onSubmit}
    />
  ));

  expect(
    screen
      .getByRole('button', { name: /Create Folder/ })
      .hasAttribute('disabled')
  ).toBe(true);
  fireEvent.input(screen.getByLabelText('Folder name'), {
    target: { value: 'Assets' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Add tags' }));
  fireEvent.click(screen.getByRole('button', { name: 'Add files' }));
  fireEvent.click(screen.getByRole('button', { name: 'Add folder' }));
  await screen.findByRole('button', { name: 'Remove Assets.zip' });
  expect(commands.create).not.toHaveBeenCalled();
  expect(commands.upload).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Remove brief.txt' }));
  await waitFor(() =>
    expect(
      screen
        .getByRole('button', { name: /Create Folder/ })
        .hasAttribute('disabled')
    ).toBe(false)
  );
  fireEvent.keyDown(screen.getByLabelText('Folder name'), {
    key: 'Enter',
    ctrlKey: true,
  });
  expect(onSubmit).toHaveBeenCalledOnce();
  const submission: FolderSubmission = onSubmit.mock.calls[0][0];
  expect(await submission.result).toEqual({
    type: 'created',
    id: 'folder-id',
    name: 'Assets',
  });
  expect(commands.saveTags).toHaveBeenCalledWith('folder-id', {
    tags: ['blue'],
  });
  expect(commands.upload).toHaveBeenCalledExactlyOnceWith('folder-id', nested);
});

it('dismisses immediately on confirmation before folder creation or uploads finish', async () => {
  const creation = Promise.withResolvers<string>();
  const upload = Promise.withResolvers<void>();
  const commands = {
    create: vi.fn(() => creation.promise),
    saveTags: vi.fn(async () => {}),
    upload: vi.fn(() => upload.promise),
  };
  const [open, setOpen] = createSignal(true);
  let submission: FolderSubmission | undefined;
  render(() => (
    <Show when={open()}>
      <CreateFolder
        commands={commands}
        destination="Drive"
        initialDraft={{
          name: 'Assets',
          tags: {},
          files: [{ file: new File(['test'], 'brief.txt'), isFolder: false }],
        }}
        onClose={() => setOpen(false)}
        onSubmit={(value) => {
          submission = value;
          setOpen(false);
        }}
      />
    </Show>
  ));
  fireEvent.click(screen.getByRole('button', { name: /Create Folder/ }));
  expect(screen.queryByRole('form', { name: 'New folder' })).toBeNull();
  expect(commands.upload).not.toHaveBeenCalled();
  creation.resolve('folder-id');
  await waitFor(() => expect(commands.upload).toHaveBeenCalledOnce());
  expect(screen.queryByRole('form', { name: 'New folder' })).toBeNull();
  upload.resolve();
  expect(await submission?.result).toEqual({
    type: 'created',
    id: 'folder-id',
    name: 'Assets',
  });
});
