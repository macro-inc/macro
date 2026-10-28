import { createRoot } from 'solid-js';
import { describe, expect, it, vi } from 'vitest';
import { createFolderComposer } from './folder-composer';

function setup() {
  const commands = {
    create: vi.fn(async (_name: string) => 'folder-id'),
    saveTags: vi.fn(async (_id: string, _tags: Record<string, string[]>) => {}),
    upload: vi.fn(
      async (_id: string, _file: { file: File; isFolder: boolean }) => {}
    ),
  };
  const composer = createRoot(() => createFolderComposer(commands));
  return { commands, composer };
}

const upload = (name: string, isFolder = false) => ({
  file: new File(['test'], name),
  isFolder,
});

describe('folder composer', () => {
  it('stages contents and tags without creating anything until submit', async () => {
    const { composer, commands } = setup();
    const file = upload('brief.txt');
    const folder = upload('Assets.zip', true);
    composer.setName('  Design  ');
    composer.setTags({ tags: ['blue'] });
    composer.addFiles([file, folder]);
    expect(commands.create).not.toHaveBeenCalled();
    expect(await composer.submit()?.result).toEqual({
      type: 'created',
      id: 'folder-id',
      name: 'Design',
    });
    expect(commands.create).toHaveBeenCalledWith('Design');
    expect(commands.saveTags).toHaveBeenCalledWith('folder-id', {
      tags: ['blue'],
    });
    expect(commands.upload.mock.calls).toEqual([
      ['folder-id', file],
      ['folder-id', folder],
    ]);
  });

  it('retries failed contents without creating another folder or reuploading successes', async () => {
    const { composer, commands } = setup();
    const file = upload('brief.txt');
    const folder = upload('Assets.zip', true);
    composer.setName('Design');
    composer.addFiles([file, folder]);
    commands.upload
      .mockResolvedValueOnce()
      .mockRejectedValueOnce(new Error('offline'));
    const failed = await composer.submit()?.result;
    expect(failed?.type).toBe('failed');
    if (failed?.type !== 'failed') throw new Error('Expected upload failure');
    expect(failed.draft.createdId).toBe('folder-id');
    expect(failed.draft.files).toEqual([folder]);
    const retry = createRoot(() =>
      createFolderComposer(commands, failed.draft)
    );
    expect(await retry.submit()?.result).toEqual({
      type: 'created',
      id: 'folder-id',
      name: 'Design',
    });
    expect(commands.create).toHaveBeenCalledTimes(1);
    expect(commands.upload.mock.calls).toEqual([
      ['folder-id', file],
      ['folder-id', folder],
      ['folder-id', folder],
    ]);
  });

  it('retains the draft when creation fails and retries tags on the same created folder', async () => {
    const { composer, commands } = setup();
    composer.setName('Design');
    composer.setTags({ tags: ['blue'] });
    commands.create.mockRejectedValueOnce(new Error('offline'));
    const failed = await composer.submit()?.result;
    if (failed?.type !== 'failed') throw new Error('Expected creation failure');
    expect(failed.draft.createdId).toBeUndefined();
    expect(failed.draft.tags).toEqual({ tags: ['blue'] });
    commands.saveTags.mockRejectedValueOnce(new Error('offline'));
    const retry = createRoot(() =>
      createFolderComposer(commands, failed.draft)
    );
    const tagsFailed = await retry.submit()?.result;
    if (tagsFailed?.type !== 'failed') throw new Error('Expected tag failure');
    expect(tagsFailed.draft.createdId).toBe('folder-id');
    const finalRetry = createRoot(() =>
      createFolderComposer(commands, tagsFailed.draft)
    );
    expect(await finalRetry.submit()?.result).toEqual({
      type: 'created',
      id: 'folder-id',
      name: 'Design',
    });
    expect(commands.create).toHaveBeenCalledTimes(2);
  });

  it('rejects empty names and concurrent submissions', async () => {
    const { composer, commands } = setup();
    await composer.submit();
    expect(commands.create).not.toHaveBeenCalled();
    composer.setName('Design');
    const first = composer.submit();
    await composer.submit();
    await first?.result;
    expect(commands.create).toHaveBeenCalledTimes(1);
  });

  it('finishes uploads after the composer is disposed, using its submitted snapshot', async () => {
    const { commands } = setup();
    const creation = Promise.withResolvers<string>();
    const uploading = Promise.withResolvers<void>();
    commands.create.mockReturnValue(creation.promise);
    commands.upload.mockReturnValue(uploading.promise);
    let dispose!: () => void;
    const composer = createRoot((cleanup) => {
      dispose = cleanup;
      return createFolderComposer(commands);
    });
    const file = upload('brief.txt');
    composer.setName('Design');
    composer.addFiles([file]);
    const submission = composer.submit();
    expect(submission).toBeDefined();
    dispose();
    creation.resolve('folder-id');
    await vi.waitFor(() =>
      expect(commands.upload).toHaveBeenCalledWith('folder-id', file)
    );
    uploading.resolve();
    expect(await submission?.result).toEqual({
      type: 'created',
      id: 'folder-id',
      name: 'Design',
    });
  });

  it('keeps files and tags when moving to a split, and clears a draft', () => {
    const { composer, commands } = setup();
    const file = upload('brief.txt');
    composer.setName('Design');
    composer.setTags({ tags: ['blue'] });
    composer.addFiles([file]);
    const restored = createRoot(() =>
      createFolderComposer(commands, composer.snapshot())
    );
    expect(restored.snapshot()).toEqual(composer.snapshot());
    restored.removeFile(file);
    expect(restored.files()).toEqual([]);
    composer.clear();
    expect(composer.snapshot()).toEqual({
      name: '',
      tags: {},
      files: [],
      createdId: undefined,
      error: undefined,
    });
  });
});
