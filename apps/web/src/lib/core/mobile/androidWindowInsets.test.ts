import { describe, expect, it } from 'vitest';
import { applyAndroidWindowInsets } from './androidWindowInsets';
import {
  virtualKeyboardHeight,
  virtualKeyboardVisible,
} from './virtualKeyboard';

describe('Android window insets', () => {
  it('uses the resized WebView height without subtracting the IME again', () => {
    applyAndroidWindowInsets(
      {
        top: 24,
        right: 0,
        bottom: 0,
        left: 0,
        imeHeight: 300,
        imeVisible: true,
        viewportHeight: 500,
      },
      500
    );
    expect(document.documentElement.style.getPropertyValue('--dvh')).toBe(
      '1dvh'
    );
    expect(virtualKeyboardHeight()).toBe(300);
    expect(
      document.documentElement.style.getPropertyValue(
        '--virtual-keyboard-height'
      )
    ).toBe('0px');
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
        viewportHeight: 380,
      },
      380
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
        viewportHeight: 1000,
      },
      500
    );
    const style = document.documentElement.style;
    expect(style.getPropertyValue('--tauri-inset-top')).toBe('24px');
    expect(style.getPropertyValue('--tauri-inset-bottom')).toBe('16px');
    expect(style.getPropertyValue('--tauri-inset-left')).toBe('12px');
    expect(style.getPropertyValue('--dvh')).toBe('1dvh');
  });
});
