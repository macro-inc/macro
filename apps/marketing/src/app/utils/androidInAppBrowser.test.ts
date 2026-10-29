import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';

const { JSDOM } = createRequire(import.meta.url)('jsdom') as {
  JSDOM: new (
    html: string,
    options?: { runScripts?: 'dangerously'; url?: string }
  ) => { window: Window & { eval(code: string): unknown } };
};

const marketing = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../..'
);

const guard = (html: string) => {
  const script = html.match(/<script data-bridge-guard>([\s\S]*?)<\/script>/);
  if (!script) throw new Error('missing Android bridge guard');
  return script[1];
};

const pages = {
  site: fs.readFileSync(path.join(marketing, 'index.html'), 'utf8'),
  start: fs.readFileSync(path.join(marketing, 'start.html'), 'utf8'),
  app: fs.readFileSync(path.join(marketing, '../web/index.html'), 'utf8'),
};

type Bridge = {
  postMessage: (...args: unknown[]) => unknown;
  postEvent?: (...args: unknown[]) => unknown;
};

type GuardWindow = Window & {
  __TAURI_INTERNALS__?: object;
  navigationPerformanceLoggerJavascriptInterface?: Bridge;
  Event: typeof Event;
  ErrorEvent: typeof ErrorEvent;
};

const boot = (before?: (target: GuardWindow) => void) => {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', {
    runScripts: 'dangerously',
    url: 'https://macro.com/',
  });
  const target = dom.window as unknown as GuardWindow;
  before?.(target);
  dom.window.eval(guard(pages.site));
  return target;
};

describe('Android in-app browser bridge guard', () => {
  it('ships the same guard on the website and the app shell', () => {
    const site = guard(pages.site);
    expect(guard(pages.start)).toBe(site);
    expect(guard(pages.app)).toBe(site);
    expect(site).toContain('navigationPerformanceLoggerJavascriptInterface');
  });

  it('swallows a collected bridge and still throws other bridge failures', () => {
    const postMessage = vi.fn(() => {
      throw new Error('Error invoking postMessage: Java object is gone');
    });
    const postEvent = vi.fn(() => {
      throw new Error('bridge down');
    });
    const target = boot((view) => {
      view.navigationPerformanceLoggerJavascriptInterface = {
        postMessage,
        postEvent,
      };
    });

    const bridge = target.navigationPerformanceLoggerJavascriptInterface;
    expect(bridge).toBeDefined();
    expect(() => bridge?.postMessage('blocking')).not.toThrow();
    expect(postMessage).toHaveBeenCalledWith('blocking');
    expect(() => bridge?.postEvent?.()).toThrow('bridge down');
  });

  it('wraps a bridge injected before the page finishes loading', () => {
    const target = boot();
    const postMessage = vi.fn(() => {
      throw new Error('Error invoking postMessage: Java object is gone');
    });
    target.navigationPerformanceLoggerJavascriptInterface = { postMessage };

    target.dispatchEvent(new target.Event('load'));

    expect(() =>
      target.navigationPerformanceLoggerJavascriptInterface?.postMessage()
    ).not.toThrow();
    expect(postMessage).toHaveBeenCalledOnce();
  });

  it('stops the uncaught bridge error and lets other window errors through', () => {
    const target = boot();
    const seen: string[] = [];
    target.addEventListener('error', (event) => {
      seen.push(event.message);
    });
    const gone = new target.ErrorEvent('error', {
      message: 'Error invoking postMessage: Java object is gone',
      cancelable: true,
    });

    target.dispatchEvent(gone);
    target.dispatchEvent(
      new target.ErrorEvent('error', { message: 'boom', cancelable: true })
    );

    expect(gone.defaultPrevented).toBe(true);
    expect(seen).toEqual(['boom']);
  });

  it('leaves the native app bridge alone', () => {
    const postMessage = vi.fn(() => {
      throw new Error('Error invoking postMessage: Java object is gone');
    });
    const target = boot((view) => {
      view.__TAURI_INTERNALS__ = {};
      view.navigationPerformanceLoggerJavascriptInterface = { postMessage };
    });

    expect(() =>
      target.navigationPerformanceLoggerJavascriptInterface?.postMessage()
    ).toThrow(/Java object is gone/);
  });
});
