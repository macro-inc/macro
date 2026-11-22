import { createSyntheticFileEntry } from '@core/util/dataTransfer';
import {
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  type LexicalEditor,
  PASTE_COMMAND,
} from 'lexical';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { filePastePlugin } from '../plugins/file-paste/filePastePlugin';
import { behaviorEditor } from './editor';

const IO = vi.hoisted(() => ({
  mobile: vi.fn<(data: DataTransfer) => boolean>(),
  recover: vi.fn<() => Promise<FileSystemFileEntry[]>>(),
  desktop: vi.fn<(files: File[]) => boolean>(),
  stage: vi.fn<(files: File[]) => Promise<FileSystemFileEntry[]>>(),
}));
vi.mock('@core/mobile/mobileClipboardImageRecovery', () => ({
  shouldUseMobileClipboardImageRecovery: IO.mobile,
  recoverMobileClipboardImageEntries: IO.recover,
}));
vi.mock('../plugins/file-paste/desktopPasteboardFiles', () => ({
  shouldStageDesktopPasteFiles: IO.desktop,
  stageDesktopPasteFiles: IO.stage,
}));

// Only the absent jsdom clipboard and filesystem/host I/O are supplied.
// The editor, command, entry extraction and plugin policy remain production.
class FixtureClipboardEvent extends Event {}
beforeEach(() => {
  vi.stubGlobal('ClipboardEvent', FixtureClipboardEvent);
  IO.mobile.mockReset().mockReturnValue(false);
  IO.recover.mockReset().mockResolvedValue([]);
  IO.desktop.mockReset().mockReturnValue(false);
  IO.stage.mockReset().mockResolvedValue([]);
});
afterEach(() => vi.unstubAllGlobals());

function clipboard(files: File[] = [], directory = false) {
  const folder = {
    isDirectory: true,
    isFile: false,
    name: 'folder',
    fullPath: '/folder',
  };
  const directoryFile = vi.fn(() => null);
  const items = files.map((file) => ({
    kind: 'file',
    type: file.type,
    getAsFile: () => file,
    webkitGetAsEntry: () => null,
  }));
  const event = new ClipboardEvent('paste', { cancelable: true });
  Object.defineProperty(event, 'clipboardData', {
    configurable: true,
    value: {
      files,
      items: directory
        ? [
            ...items,
            {
              kind: 'file',
              type: '',
              getAsFile: directoryFile,
              webkitGetAsEntry: () => folder,
            },
          ]
        : items,
      types: files.length || directory ? ['Files'] : [],
      getData: () => '',
    },
  });
  return { event, folder, directoryFile };
}
function mountPaste() {
  const received =
    vi.fn<
      (
        files: FileSystemFileEntry[],
        directories: FileSystemDirectoryEntry[]
      ) => void
    >();
  let release = () => {};
  const fixture = behaviorEditor((editor) => {
    release = filePastePlugin({ onPasteFilesAndDirs: received })(editor);
    return () => release();
  });
  fixture.editor.update(
    () =>
      $getRoot()
        .append($createParagraphNode().append($createTextNode('Keep draft')))
        .selectEnd(),
    { discrete: true }
  );
  return {
    ...fixture,
    received,
    before: fixture.editor.getEditorState().toJSON(),
    dispose: () => {
      const dispose = release;
      release = () => {};
      dispose();
    },
  };
}
function paste(editor: LexicalEditor, event: ClipboardEvent | InputEvent) {
  let handled = false;
  editor.update(
    () => {
      handled = editor.dispatchCommand(PASTE_COMMAND, event);
    },
    { discrete: true }
  );
  return handled;
}
function pendingEntries() {
  let resolve!: (entries: FileSystemFileEntry[]) => void;
  const promise = new Promise<FileSystemFileEntry[]>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function entryFile(entry: FileSystemFileEntry) {
  return new Promise<File>((resolve, reject) => entry.file(resolve, reject));
}

describe('actual file paste policy', () => {
  it('prefers directories over phantom duplicate files and skips mobile recovery and desktop staging', () => {
    const fixture = mountPaste();
    IO.mobile.mockReturnValue(true);
    IO.desktop.mockReturnValue(true);
    const { event, folder, directoryFile } = clipboard(
      [new File(['duplicate'], 'child.txt')],
      true
    );
    expect(paste(fixture.editor, event)).toBe(true);
    expect(event.defaultPrevented).toBe(false);
    expect(fixture.received).toHaveBeenCalledExactlyOnceWith([], [folder]);
    expect(directoryFile).not.toHaveBeenCalled();
    expect(IO.mobile).not.toHaveBeenCalled();
    expect(IO.recover).not.toHaveBeenCalled();
    expect(IO.desktop).not.toHaveBeenCalled();
    expect(IO.stage).not.toHaveBeenCalled();
    expect(fixture.editor.getEditorState().toJSON()).toEqual(fixture.before);
  });

  it('waits for mobile recovery before any desktop staging and prefers recovered entries', async () => {
    const fixture = mountPaste();
    const pending = pendingEntries();
    IO.mobile.mockReturnValue(true);
    IO.desktop.mockReturnValue(true);
    IO.recover.mockReturnValue(pending.promise);
    const original = new File(['original'], 'original.png');
    const recovered = createSyntheticFileEntry(
      new File(['recovered'], 'recovered.png')
    );
    const { event } = clipboard([original]);
    expect(paste(fixture.editor, event)).toBe(true);
    expect(event.defaultPrevented).toBe(true);
    expect(fixture.received).not.toHaveBeenCalled();
    expect(IO.desktop).not.toHaveBeenCalled();
    expect(IO.stage).not.toHaveBeenCalled();
    pending.resolve([recovered]);
    await pending.promise;
    expect(fixture.received).toHaveBeenCalledExactlyOnceWith([recovered], []);
    expect(IO.desktop).not.toHaveBeenCalled();
    expect(IO.stage).not.toHaveBeenCalled();
    expect(fixture.editor.getEditorState().toJSON()).toEqual(fixture.before);
  });

  it('falls back to the original extracted file when mobile recovery resolves empty', async () => {
    const fixture = mountPaste();
    const pending = pendingEntries();
    IO.mobile.mockReturnValue(true);
    IO.desktop.mockReturnValue(true);
    IO.recover.mockReturnValue(pending.promise);
    const original = new File(['original'], 'original.png');
    const { event } = clipboard([original]);
    expect(paste(fixture.editor, event)).toBe(true);
    pending.resolve([]);
    await pending.promise;
    expect(fixture.received).toHaveBeenCalledOnce();
    const [files, directories] = fixture.received.mock.calls[0];
    expect(files).toHaveLength(1);
    expect(await entryFile(files[0])).toBe(original);
    expect(directories).toEqual([]);
    expect(IO.desktop).not.toHaveBeenCalled();
    expect(IO.stage).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(true);
    expect(fixture.editor.getEditorState().toJSON()).toEqual(fixture.before);
  });

  it('consumes an empty mobile recovery without issuing a file callback or desktop fallback', async () => {
    const fixture = mountPaste();
    const pending = pendingEntries();
    IO.mobile.mockReturnValue(true);
    IO.recover.mockReturnValue(pending.promise);
    const { event } = clipboard();
    expect(paste(fixture.editor, event)).toBe(true);
    pending.resolve([]);
    await pending.promise;
    expect(event.defaultPrevented).toBe(true);
    expect(fixture.received).not.toHaveBeenCalled();
    expect(IO.desktop).not.toHaveBeenCalled();
    expect(IO.stage).not.toHaveBeenCalled();
    expect(fixture.editor.getEditorState().toJSON()).toEqual(fixture.before);
  });

  it.each(['non-clipboard', 'absent-data', 'empty-data'] as const)(
    'yields for %s without preventing default or issuing IO',
    (mode) => {
      const fixture = mountPaste();
      const { event } = clipboard();
      if (mode === 'absent-data')
        Object.defineProperty(event, 'clipboardData', { value: null });
      const input =
        mode === 'non-clipboard'
          ? new InputEvent('input', { cancelable: true })
          : event;
      expect(paste(fixture.editor, input)).toBe(false);
      expect(input.defaultPrevented).toBe(false);
      expect(fixture.received).not.toHaveBeenCalled();
      expect(IO.mobile).toHaveBeenCalledTimes(mode === 'empty-data' ? 1 : 0);
      expect(IO.recover).not.toHaveBeenCalled();
      expect(IO.desktop).not.toHaveBeenCalled();
      expect(IO.stage).not.toHaveBeenCalled();
      expect(fixture.editor.getEditorState().toJSON()).toEqual(fixture.before);
    }
  );

  it('prevents default while desktop staging waits and forwards the staged entries once', async () => {
    const fixture = mountPaste();
    const pending = pendingEntries();
    IO.desktop.mockReturnValue(true);
    IO.stage.mockReturnValue(pending.promise);
    const original = new File(['original'], 'original.mov');
    const staged = createSyntheticFileEntry(new File(['staged'], 'staged.mov'));
    const { event } = clipboard([original]);
    expect(paste(fixture.editor, event)).toBe(true);
    expect(event.defaultPrevented).toBe(true);
    expect(IO.stage).toHaveBeenCalledExactlyOnceWith([original]);
    expect(IO.recover).not.toHaveBeenCalled();
    expect(fixture.received).not.toHaveBeenCalled();
    pending.resolve([staged]);
    await pending.promise;
    expect(fixture.received).toHaveBeenCalledExactlyOnceWith([staged], []);
    expect(fixture.editor.getEditorState().toJSON()).toEqual(fixture.before);
  });

  it('forwards direct extracted browser files without preventing default', async () => {
    const fixture = mountPaste();
    const original = new File(['original'], 'original.txt');
    const { event } = clipboard([original]);
    expect(paste(fixture.editor, event)).toBe(true);
    expect(event.defaultPrevented).toBe(false);
    expect(IO.desktop).toHaveBeenCalledExactlyOnceWith([original]);
    expect(IO.stage).not.toHaveBeenCalled();
    expect(IO.recover).not.toHaveBeenCalled();
    expect(fixture.received).toHaveBeenCalledOnce();
    const [files, directories] = fixture.received.mock.calls[0];
    expect(files).toHaveLength(1);
    expect(await entryFile(files[0])).toBe(original);
    expect(directories).toEqual([]);
    expect(fixture.editor.getEditorState().toJSON()).toEqual(fixture.before);
  });

  it('unregisters the actual paste handler on disposal', () => {
    const fixture = mountPaste();
    fixture.dispose();
    const { event } = clipboard([new File(['original'], 'original.txt')]);
    expect(paste(fixture.editor, event)).toBe(false);
    expect(event.defaultPrevented).toBe(false);
    expect(fixture.received).not.toHaveBeenCalled();
    expect(IO.mobile).not.toHaveBeenCalled();
    expect(IO.desktop).not.toHaveBeenCalled();
    expect(fixture.editor.getEditorState().toJSON()).toEqual(fixture.before);
  });
});
