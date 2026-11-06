import { Blob as NodeBlob } from 'node:buffer';
import { beforeEach, expect, it, vi } from 'vitest';
import { hasIosFileExport } from './iosFiles';
import { exportNativeFile } from './nativeFileExport';

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke }));

beforeEach(() => {
  invoke.mockReset();
  invoke.mockImplementation(async (command: string) => {
    if (command.endsWith('available')) return true;
    if (command.endsWith('beginExport')) return { token: 'ios-export' };
    if (command.endsWith('finishExport')) return { canceled: false };
  });
});

it('detects older native binaries without attempting an export', async () => {
  invoke.mockRejectedValue('Plugin file-export not found');
  expect(await hasIosFileExport()).toBe(false);
  expect(invoke).toHaveBeenCalledOnce();
});

it('exports original file bytes to the iOS save picker', async () => {
  const data = new Uint8Array(600_000).map((_, i) => i % 251);
  vi.stubGlobal('Blob', NodeBlob);
  try {
    await exportNativeFile(
      'file-export',
      new Blob([data], { type: 'video/mp4' }),
      'demo.mp4',
      'save'
    );
    const chunks = invoke.mock.calls.filter(([cmd]) =>
      cmd.endsWith('appendExport')
    );
    expect(chunks).toHaveLength(3);
    expect(
      Uint8Array.from(chunks.map(([, args]) => atob(args.data)).join(''), (c) =>
        c.charCodeAt(0)
      )
    ).toEqual(data);
    expect(invoke).toHaveBeenCalledWith('plugin:file-export|finishExport', {
      token: 'ios-export',
      action: 'save',
    });
  } finally {
    vi.unstubAllGlobals();
  }
});

it('dismisses an open iOS chooser on cancellation and cleans staged bytes', async () => {
  const opened = Promise.withResolvers<void>();
  const result = Promise.withResolvers<{ canceled: boolean }>();
  invoke.mockImplementation(async (command: string) => {
    if (command.endsWith('beginExport')) return { token: 'ios-export' };
    if (command.endsWith('finishExport')) {
      opened.resolve();
      return result.promise;
    }
    if (command.endsWith('discardExport')) result.resolve({ canceled: true });
  });
  const controller = new AbortController();
  const exporting = exportNativeFile(
    'file-export',
    new Blob([]),
    'empty.txt',
    'save',
    { signal: controller.signal }
  );
  await opened.promise;
  controller.abort();
  expect(await exporting).toEqual({ canceled: true });
  expect(invoke).toHaveBeenLastCalledWith('plugin:file-export|discardExport', {
    token: 'ios-export',
  });
});
