import { beforeEach, describe, expect, it, vi } from 'vitest';

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke }));

import { exportAndroidFile } from './androidFiles';

beforeEach(() => {
  invoke.mockReset();
  invoke.mockImplementation(async (command: string) => {
    if (command.endsWith('beginExport')) return { token: 'test-token' };
    if (command.endsWith('finishExport')) return { canceled: false };
  });
});

describe('Android Blob export', () => {
  it('transfers the original bytes in bounded ordered chunks before opening a save dialog', async () => {
    const bytes = new Uint8Array(600_000).map((_, i) => i % 251);
    // Node Blob supplies arrayBuffer, unlike jsdom Blob.
    const { Blob } = await import('node:buffer');
    await exportAndroidFile(
      new Blob([bytes], { type: 'image/png' }) as unknown as globalThis.Blob,
      'drawing.png'
    );
    const chunks = invoke.mock.calls.filter(([command]) =>
      command.endsWith('appendExport')
    );
    expect(chunks).toHaveLength(3);
    const copied = chunks.map(([, args]) => atob(args.data)).join('');
    expect(Uint8Array.from(copied, (char) => char.charCodeAt(0))).toEqual(
      bytes
    );
    expect(invoke).toHaveBeenLastCalledWith(
      'plugin:android-mobile|discardExport',
      { token: 'test-token' }
    );
    expect(invoke).toHaveBeenCalledWith('plugin:android-mobile|finishExport', {
      token: 'test-token',
      action: 'save',
    });
  });

  it('declares the total size up front so native can reject oversized exports before streaming', async () => {
    invoke.mockImplementation(async (command: string) => {
      if (command.endsWith('beginExport'))
        throw new Error('Attachments exceed the 500 MB limit');
    });
    const { Blob } = await import('node:buffer');
    await expect(
      exportAndroidFile(
        new Blob([new Uint8Array(600_000)], {
          type: 'video/mp4',
        }) as unknown as globalThis.Blob,
        'video.mp4'
      )
    ).rejects.toThrow('500 MB');
    expect(invoke).toHaveBeenCalledWith('plugin:android-mobile|beginExport', {
      name: 'video.mp4',
      mimeType: 'video/mp4',
      size: 600_000,
    });
    expect(invoke).toHaveBeenCalledOnce();
  });

  it('discards partial staging after an IPC failure without opening a chooser', async () => {
    invoke.mockImplementation(async (command: string) => {
      if (command.endsWith('beginExport')) return { token: 'test-token' };
      if (command.endsWith('appendExport')) throw new Error('Disk full');
    });
    const { Blob } = await import('node:buffer');
    await expect(
      exportAndroidFile(
        new Blob(['draft']) as unknown as globalThis.Blob,
        'draft.txt'
      )
    ).rejects.toThrow('Disk full');
    expect(
      invoke.mock.calls.some(([command]) => command.endsWith('finishExport'))
    ).toBe(false);
    expect(invoke).toHaveBeenLastCalledWith(
      'plugin:android-mobile|discardExport',
      { token: 'test-token' }
    );
  });
  it('cancels between chunks and deletes staging without opening a chooser', async () => {
    const controller = new AbortController();
    const { Blob } = await import('node:buffer');
    await expect(
      exportAndroidFile(
        new Blob([new Uint8Array(600_000)]) as unknown as globalThis.Blob,
        'video.mp4',
        'share',
        {
          signal: controller.signal,
          onProgress: () => controller.abort(),
        }
      )
    ).rejects.toThrow();
    expect(
      invoke.mock.calls.filter(([command]) => command.endsWith('appendExport'))
    ).toHaveLength(1);
    expect(
      invoke.mock.calls.some(([command]) => command.endsWith('finishExport'))
    ).toBe(false);
    expect(invoke).toHaveBeenLastCalledWith(
      'plugin:android-mobile|discardExport',
      { token: 'test-token' }
    );
  });
});
