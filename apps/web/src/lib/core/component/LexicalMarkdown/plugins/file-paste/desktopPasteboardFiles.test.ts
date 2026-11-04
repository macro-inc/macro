import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  isDesktop: vi.fn(() => true),
}));
vi.mock('@tauri-apps/api/core', () => ({
  invoke: mocks.invoke,
  convertFileSrc: (path: string) => path,
}));
vi.mock('@core/util/platform', () => ({
  isDesktopPlatform: mocks.isDesktop,
}));

import { getNativeStagedUpload } from '@core/mobile/nativeStagedUpload';
import {
  shouldStageDesktopPasteFiles,
  stageDesktopPasteFiles,
} from './desktopPasteboardFiles';

function sizedFile(name: string, type: string, size: number): File {
  const file = new File([], name, { type });
  Object.defineProperty(file, 'size', { value: size });
  return file;
}

function entryFile(entry: FileSystemFileEntry): Promise<File> {
  return new Promise((resolve) => entry.file(resolve));
}

describe('desktop pasted files', () => {
  beforeEach(() => {
    mocks.invoke.mockReset();
    mocks.isDesktop.mockReturnValue(true);
  });

  it('stages only when a desktop paste carries a large file', () => {
    const small = sizedFile('note.txt', 'text/plain', 1024);
    const large = sizedFile('clip.mov', 'video/quicktime', 2_000_000_000);

    expect(shouldStageDesktopPasteFiles([small])).toBe(false);
    expect(shouldStageDesktopPasteFiles([small, large])).toBe(true);

    mocks.isDesktop.mockReturnValue(false);
    expect(shouldStageDesktopPasteFiles([large])).toBe(false);
  });

  it('tags pasted files matching the staged pasteboard files', async () => {
    const video = sizedFile('clip.mov', 'video/quicktime', 2_000_000_000);
    const image = sizedFile('image.png', 'image/png', 5000);
    mocks.invoke.mockResolvedValue([
      {
        token: 'paste-stage-abc',
        name: 'clip.mov',
        mimeType: 'application/octet-stream',
        size: 2_000_000_000,
        sha256: 'ab'.repeat(32),
      },
    ]);

    const entries = await stageDesktopPasteFiles([video, image]);

    expect(mocks.invoke).toHaveBeenCalledWith('stage_desktop_pasteboard_files');
    const [first, second] = await Promise.all(entries.map(entryFile));
    expect(first).toBe(video);
    expect(second).toBe(image);
    expect(getNativeStagedUpload(video)).toEqual({
      source: 'pasteboard',
      token: 'paste-stage-abc',
      name: 'clip.mov',
      mimeType: 'video/quicktime',
      size: 2_000_000_000,
      sha256: 'ab'.repeat(32),
      previewSrc: undefined,
    });
    expect(getNativeStagedUpload(image)).toBeUndefined();
  });

  it('falls back to browser files when staging fails', async () => {
    const video = sizedFile('clip.mov', 'video/quicktime', 2_000_000_000);
    mocks.invoke.mockRejectedValue(new Error('no pasteboard'));
    vi.spyOn(console, 'error').mockImplementation(() => {});

    const entries = await stageDesktopPasteFiles([video]);

    expect(await entryFile(entries[0])).toBe(video);
    expect(getNativeStagedUpload(video)).toBeUndefined();
  });
});
