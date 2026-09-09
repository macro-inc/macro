import { LexicalBuilder } from '@lexical/extension';
import { createRoot } from 'solid-js';
import { describe, expect, test, vi } from 'vitest';
import { buildConfig } from './MarkdownConfigBuilder';

vi.hoisted(() => {
  class FakeWebSocket extends EventTarget {
    static readonly CONNECTING = 0;
    static readonly OPEN = 1;
    static readonly CLOSING = 2;
    static readonly CLOSED = 3;
    readonly readyState = FakeWebSocket.OPEN;
    close() {}
    send() {}
  }
  Object.defineProperty(globalThis, 'WebSocket', {
    configurable: true,
    value: FakeWebSocket,
  });
});

describe('MarkdownConfigBuilder extension lifecycle', () => {
  test('builds an extension graph and disposes custom registrations', () => {
    createRoot((dispose) => {
      const cleanup = vi.fn();
      const register = vi.fn(() => cleanup);
      const handle = buildConfig('plain-text')
        .namespace('extension-lifecycle-test')
        .use(register)
        .buildHandle();

      const builder = LexicalBuilder.maybeFromEditor(handle.lexical);
      expect(builder).toBeDefined();
      expect([...builder!.extensionNameMap.keys()]).toEqual(
        expect.arrayContaining([
          '@lexical/plain-text',
          '@macro-inc/lexical/builder/state',
          '@macro-inc/lexical/builder/custom-0',
        ])
      );
      expect(register).toHaveBeenCalledWith(handle.lexical);
      expect('plugins' in handle).toBe(false);

      handle._internal.cleanupLexical();
      expect(cleanup).toHaveBeenCalledOnce();
      dispose();
    });
  });
});
