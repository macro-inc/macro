import type { NativeMarkdownOverlayInstallation } from '@core/component/LexicalMarkdown/editing/nativeOverlayPorts';
import { SessionTelemetry } from '@macro-inc/collaboration/session/telemetry';
import { createBuiltinRegistry } from '@macro-inc/lexical-wasm-view';
import { NOOP_SPAN, Telemetry } from '@macro-inc/observability';
import { afterEach, expect, test, vi } from 'vitest';
import { createRustEditorSession } from './create-editor-session';
import * as module from './wasm/document_session_wasm.js';

// Only the external mount is replaced: these tests exercise app installation
// ownership and failure unwinding, not native input or model semantics.
const MOUNT = vi.hoisted(() => ({
  mount: vi.fn(),
  close: vi.fn<() => Promise<void>>(),
}));

vi.mock('@macro-inc/lexical-wasm-view', async (original) => ({
  ...(await original<typeof import('@macro-inc/lexical-wasm-view')>()),
  mountSessionView: (...args: unknown[]) => MOUNT.mount(...args),
}));

afterEach(() => {
  vi.restoreAllMocks();
  MOUNT.mount.mockReset();
  MOUNT.close.mockReset();
});

function options() {
  MOUNT.mount.mockReturnValue({ view: {}, close: MOUNT.close });
  return {
    module,
    root: document.createElement('div'),
    registry: createBuiltinRegistry(),
    view: {
      namespace: 'overlay-lifecycle',
      theme: {},
      editable: true,
      preset: 'rich' as const,
      onError(error: unknown) {
        throw error;
      },
    },
    documentId: 'overlay-lifecycle',
    user: 'fixture-user',
    access: 2,
    authorization: {
      async token() {
        throw new Error('Mount boundary must not request a token');
      },
      subscribe() {
        throw new Error('Mount boundary owns authorization');
      },
    },
    viewEngine: 1,
    viewOs: 0,
    span: NOOP_SPAN,
    onStatus() {
      throw new Error('Mount boundary must not publish status');
    },
  };
}

test('overlay disposal reentry retains one in-flight close and releases each owner once', async () => {
  const disposed = Promise.withResolvers<void>();
  const terminal = Promise.withResolvers<void>();
  MOUNT.close.mockReturnValue(terminal.promise);
  const releaseTelemetry = vi.spyOn(SessionTelemetry.prototype, 'close');
  let runtime: ReturnType<typeof createRustEditorSession> | undefined;
  let reentered: Promise<void> | undefined;
  const dispose = vi.fn(() => {
    reentered = runtime?.close();
    disposed.resolve();
  });
  runtime = createRustEditorSession({
    ...options(),
    installOverlays: () => ({
      focusAtEnd() {
        throw new Error('Close must not move selection');
      },
      dispose,
    }),
  });
  const closing = runtime.close();
  expect(runtime.close()).toBe(closing);
  await disposed.promise;
  expect(reentered).toBe(closing);
  expect(dispose).toHaveBeenCalledTimes(1);
  expect(MOUNT.close).toHaveBeenCalledTimes(1);
  expect(releaseTelemetry).not.toHaveBeenCalled();
  terminal.resolve();
  await closing;
  expect(releaseTelemetry).toHaveBeenCalledTimes(1);
  expect(runtime.close()).toBe(closing);
});

test.each([null, undefined, { phase: 'editing-install' }])(
  'later installer failure preserves opaque cause %j even if overlay disposal fails',
  async (primary) => {
    const released = Promise.withResolvers<void>();
    MOUNT.close.mockResolvedValue();
    const cleanupError = new Error('Overlay disposal failed');
    const report = vi.spyOn(Telemetry, 'error').mockImplementation(() => {});
    const releaseTelemetry = vi
      .spyOn(SessionTelemetry.prototype, 'close')
      .mockImplementation(() => released.resolve());
    const installation: NativeMarkdownOverlayInstallation = {
      focusAtEnd() {
        throw new Error('Failed installation must not move selection');
      },
      dispose: vi.fn(() => {
        throw cleanupError;
      }),
    };
    let caught: { value: unknown } | undefined;
    try {
      createRustEditorSession({
        ...options(),
        installOverlays: () => installation,
        installEditing() {
          throw primary;
        },
      });
    } catch (value) {
      caught = { value };
    }
    expect(caught).toEqual({ value: primary });
    await released.promise;
    expect(installation.dispose).toHaveBeenCalledTimes(1);
    expect(MOUNT.close).toHaveBeenCalledTimes(1);
    expect(releaseTelemetry).toHaveBeenCalledTimes(1);
    // Wait for the deliberately detached close failure to be reported.
    await Promise.resolve();
    expect(report).toHaveBeenCalledWith(cleanupError, {
      surface: 'rust-editor.mount.close',
    });
  }
);
