import { cleanup, render } from '@solidjs/testing-library';
import { children } from 'solid-js';
import { afterEach, expect, it, vi } from 'vitest';
import { DatabasePageShell } from './DatabasePageShell';

// The connection gateway's socket opens on import; this page needs none.
vi.hoisted(() => {
  globalThis.WebSocket = class extends EventTarget {
    readyState = 3;
    send() {}
    close() {}
  } as unknown as typeof WebSocket;
});
vi.mock('@components/app/split-layout/layoutUtils', () => ({
  useSplitPanel: () => undefined,
}));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

// BlockContainer marks its children as the block element only when they
// resolve to a single HTMLElement, and logs an error on every change otherwise.
it('resolves to the one element the block container marks as the block', () => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  );
  let resolved: unknown;

  render(() => {
    const shell = children(() => (
      <DatabasePageShell>
        <p>Guests</p>
      </DatabasePageShell>
    ));
    resolved = shell();
    return <>{shell()}</>;
  });

  expect(resolved).toBeInstanceOf(HTMLElement);
  expect((resolved as HTMLElement).textContent).toContain('Guests');
});
