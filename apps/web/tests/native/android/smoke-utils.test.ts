import { describe, expect, test } from 'bun:test';
import { screenPointForInput, testShareTokens } from './smoke-utils.mjs';

describe('Android smoke fixture isolation', () => {
  test.each([1, 1.5, 2.625])(
    'maps CSS input bounds at scale %s with a window offset',
    (scale) => {
      const hierarchy = `<node class="android.webkit.WebView" package="com.macro.workspace.mobile" bounds="[30,60][${30 + 400 * scale},${60 + 800 * scale}]"/>`;
      expect(
        screenPointForInput(hierarchy, 'com.macro.workspace.mobile', {
          rect: { left: 20, top: 100, width: 300, height: 80 },
          viewport: { left: 10, top: 20, width: 400, height: 800 },
        })
      ).toEqual({
        x: Math.round(30 + 160 * scale),
        y: Math.round(60 + 120 * scale),
      });
    }
  );

  test('refuses to tap when the input is outside the visible viewport', () => {
    expect(() =>
      screenPointForInput(
        '<node class="android.webkit.WebView" package="com.macro.workspace.mobile" bounds="[0,0][1080,2400]"/>',
        'com.macro.workspace.mobile',
        {
          rect: { left: 500, top: 100, width: 100, height: 80 },
          viewport: { left: 0, top: 0, width: 400, height: 800 },
        }
      )
    ).toThrow('Input center is outside');
  });

  test('uses native container bounds when Chromium exposes a nested WebView', () => {
    const hierarchy =
      '<node class="android.webkit.WebView" package="com.macro.workspace.mobile" bounds="[30,60][830,1660]"><node class="android.webkit.WebView" package="com.macro.workspace.mobile" bounds="[30,80][830,1640]"/></node>';
    expect(
      screenPointForInput(hierarchy, 'com.macro.workspace.mobile', {
        rect: { left: 20, top: 100, width: 300, height: 80 },
        viewport: { left: 0, top: 0, width: 400, height: 800 },
      })
    ).toEqual({ x: 370, y: 340 });
  });

  test('selects only this run’s image and text tokens from mixed queued batches', () => {
    const token = (id: string) => `share-stage-${id.repeat(32)}`;
    const fixture = {
      imageName: 'smoke-current-run.png',
      sharedText: 'https://example.com/android-smoke/current-run',
    };
    const files = [
      { token: token('a'), name: 'personal.png' },
      { token: token('b'), name: fixture.imageName },
      { token: token('c'), isSharedText: true, sharedText: fixture.sharedText },
      { token: token('d'), isSharedText: true, sharedText: 'personal text' },
      { token: token('e'), name: 'smoke-previous-run.png' },
    ];
    expect(testShareTokens(files, fixture)).toEqual([token('b'), token('c')]);
    expect(testShareTokens(files.slice(0, 1), fixture)).toEqual([]);
  });
});
