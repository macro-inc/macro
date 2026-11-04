import { createScene } from '@macro-inc/graphics';
import { describe, expect, it, vi } from 'vitest';

const startup = vi.hoisted(() => {
  const disconnect = vi.fn();
  return {
    entered: Promise.withResolvers<void>(),
    connected: Promise.withResolvers<{ disconnect: typeof disconnect }>(),
    disconnect,
    close: vi.fn(),
  };
});
vi.mock('@cloudflare/puppeteer', () => ({
  default: {
    connect: () => {
      startup.entered.resolve();
      return startup.connected.promise;
    },
  },
}));
vi.mock(
  '@cloudflare/puppeteer/internal/common/BrowserWebSocketTransport.js',
  () => ({
    BrowserWebSocketTransport: {
      create: async () => ({ close: startup.close }),
    },
  })
);
const { createCanvasRenderer } = await import('./render');

describe('Canvas browser lifecycle', () => {
  it('releases a browser that finishes connecting after its caller aborts', async () => {
    vi.stubGlobal('fetch', async () =>
      Response.json({
        webSocketDebuggerUrl: 'ws://localhost:9222/devtools/browser/test',
      })
    );
    const controller = new AbortController();
    try {
      const render = createCanvasRenderer({
        CANVAS_RENDER_URL: 'https://canvas.test/canvas-render.html',
        CANVAS_BROWSER_URL: 'http://localhost:9222',
      });
      const pending = render(
        { document: createScene(), clock: {} },
        {},
        controller.signal
      );
      await startup.entered.promise;
      controller.abort();
      await expect(pending).rejects.toThrow();
      startup.connected.resolve({ disconnect: startup.disconnect });
      await startup.connected.promise;
      expect(startup.close).toHaveBeenCalled();
      expect(startup.disconnect).toHaveBeenCalledOnce();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('rejects crops the camera cannot faithfully represent before acquiring a browser', async () => {
    const render = createCanvasRenderer({
      CANVAS_RENDER_URL: 'https://canvas.test/canvas-render.html',
      CANVAS_BROWSER_URL: '',
    });
    await expect(
      render(
        { document: createScene(), clock: {} },
        { crop: { x: 0, y: 0, width: 1_000_000, height: 1_000_000 } }
      )
    ).rejects.toThrow('zoom limit');
  });
});
