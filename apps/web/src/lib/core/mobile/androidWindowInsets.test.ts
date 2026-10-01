import { afterEach, describe, expect, it, vi } from 'vitest';
import { applyAndroidWindowInsets } from './androidWindowInsets';
import {
  virtualKeyboardHeight,
  virtualKeyboardVisible,
} from './virtualKeyboard';

afterEach(() => {
  document.documentElement.removeAttribute('style');
  vi.restoreAllMocks();
});

describe('Android window insets', () => {
  it('shrinks the layout root by the keyboard and lifts fixed sheets, like iOS', () => {
    applyAndroidWindowInsets(
      {
        top: 24,
        right: 0,
        bottom: 0,
        left: 0,
        imeHeight: 300,
        imeVisible: true,
        viewportWidth: 400,
        viewportHeight: 500,
      },
      400
    );
    // The WebView is not resized: 500 - 300 = 200 CSS px of layout root.
    expect(document.documentElement.style.getPropertyValue('--dvh')).toBe(
      '2px'
    );
    expect(virtualKeyboardHeight()).toBe(300);
    expect(
      document.documentElement.style.getPropertyValue(
        '--virtual-keyboard-height'
      )
    ).toBe('300px');
    expect(virtualKeyboardVisible()).toBe(true);
  });

  it('updates every safe edge on rotation and restores the navigation inset after hiding', () => {
    applyAndroidWindowInsets(
      {
        top: 0,
        right: 24,
        bottom: 20,
        left: 32,
        imeHeight: 0,
        imeVisible: false,
        viewportWidth: 800,
        viewportHeight: 380,
      },
      800
    );
    const style = document.documentElement.style;
    expect(style.getPropertyValue('--dvh')).toBe('1dvh');
    expect(style.getPropertyValue('--tauri-inset-right')).toBe('24px');
    expect(style.getPropertyValue('--tauri-inset-left')).toBe('32px');
    expect(style.getPropertyValue('--tauri-inset-bottom')).toBe('20px');
    expect(virtualKeyboardVisible()).toBe(false);
  });

  it('converts native safe areas into CSS pixels during display-density changes', () => {
    applyAndroidWindowInsets(
      {
        top: 48,
        right: 0,
        bottom: 32,
        left: 24,
        imeHeight: 0,
        imeVisible: false,
        viewportWidth: 800,
        viewportHeight: 1000,
      },
      400
    );
    const style = document.documentElement.style;
    expect(style.getPropertyValue('--tauri-inset-top')).toBe('24px');
    expect(style.getPropertyValue('--tauri-inset-bottom')).toBe('16px');
    expect(style.getPropertyValue('--tauri-inset-left')).toBe('12px');
    expect(style.getPropertyValue('--dvh')).toBe('1dvh');
  });

  it('keeps the safe areas when a keyboard resize shrinks only the height', () => {
    const closed = {
      top: 36,
      right: 0,
      bottom: 27,
      left: 0,
      imeHeight: 0,
      imeVisible: false,
      viewportWidth: 384,
      viewportHeight: 832,
    };
    applyAndroidWindowInsets(closed, 384);
    const style = document.documentElement.style;
    expect(style.getPropertyValue('--tauri-inset-top')).toBe('36px');
    // The window resize event fires before the next insets event; the stale
    // insets must not be rescaled by the shorter viewport.
    const setProperty = vi.spyOn(style, 'setProperty');
    applyAndroidWindowInsets(closed, 384);
    expect(style.getPropertyValue('--tauri-inset-top')).toBe('36px');
    expect(setProperty).not.toHaveBeenCalled();
  });

  it('writes only the root properties whose value changed', () => {
    const style = document.documentElement.style;
    const closed = {
      top: 36,
      right: 0,
      bottom: 27,
      left: 0,
      imeHeight: 0,
      imeVisible: false,
      viewportWidth: 384,
      viewportHeight: 832,
    };
    applyAndroidWindowInsets(closed, 384);
    const setProperty = vi.spyOn(style, 'setProperty');
    applyAndroidWindowInsets(
      { ...closed, bottom: 0, imeHeight: 358, imeVisible: true },
      384
    );
    // Only the values the keyboard changes: no top/left/right rewrite.
    expect(setProperty).toHaveBeenCalledTimes(3);
    expect(setProperty).toHaveBeenCalledWith('--tauri-inset-bottom', '0px');
    expect(setProperty).toHaveBeenCalledWith('--dvh', '4.74px');
    expect(setProperty).toHaveBeenCalledWith(
      '--virtual-keyboard-height',
      '358px'
    );
    expect(virtualKeyboardHeight()).toBe(358);
  });
});
