/** @vitest-environment jsdom */

import {
  initializeNativeSurfaceTests,
  nativeSurface,
  transfer,
} from '@macro-inc/lexical-wasm-view/view/test/native-surface';
import { beforeAll, expect, test, vi } from 'vitest';

vi.mock('@core/mobile/mobileClipboardImageRecovery', () => ({
  shouldUseMobileClipboardImageRecovery: () => false,
  recoverMobileClipboardImageEntries: async () => [],
}));
vi.mock('./desktopPasteboardFiles', () => ({
  shouldStageDesktopPasteFiles: () => false,
  stageDesktopPasteFiles: async () => [],
}));

import { registerNativeFilePaste } from './native';

beforeAll(initializeNativeSurfaceTests);

test('native policy hands the exact pasted file entries to the view IO callback once', async () => {
  const fixture = nativeSurface();
  const files: FileSystemFileEntry[][] = [];
  const directories: FileSystemDirectoryEntry[][] = [];
  const release = registerNativeFilePaste(fixture.view, {
    onPasteFilesAndDirs(entries, folders) {
      files.push(entries);
      directories.push(folders);
    },
  });
  try {
    const file = new File(['payload'], 'fixture.txt', { type: 'text/plain' });
    expect(
      await fixture.view.clipboard.paste(transfer('fixture.txt', '', [file]))
    ).toBe(true);
    expect(files).toHaveLength(1);
    expect(files[0]).toHaveLength(1);
    const entry = files[0]?.[0];
    if (!entry) throw new Error('Missing pasted entry');
    const received = await new Promise<File>((resolve, reject) =>
      entry.file(resolve, reject)
    );
    expect(received).toBe(file);
    expect(directories).toEqual([[]]);
    expect(fixture.root.textContent).toBe('');
  } finally {
    release();
    fixture.close();
  }
});
