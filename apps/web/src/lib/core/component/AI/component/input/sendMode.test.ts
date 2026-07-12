import { describe, expect, test } from 'vitest';
import { getSendModeFromEnterKeyEvent, shouldOpenChatSplit } from './sendMode';

describe('chat send mode', () => {
  test('uses foreground mode for plain enter', () => {
    expect(
      getSendModeFromEnterKeyEvent({
        metaKey: false,
        ctrlKey: false,
        shiftKey: false,
      })
    ).toBe('foreground');
  });

  test('uses foreground mode for shift+enter newline flow', () => {
    expect(
      getSendModeFromEnterKeyEvent({
        metaKey: false,
        ctrlKey: false,
        shiftKey: true,
      })
    ).toBe('foreground');
  });

  test('uses background mode for cmd+shift+enter', () => {
    expect(
      getSendModeFromEnterKeyEvent({
        metaKey: true,
        ctrlKey: false,
        shiftKey: true,
      })
    ).toBe('background');
  });

  test('uses background mode for ctrl+shift+enter', () => {
    expect(
      getSendModeFromEnterKeyEvent({
        metaKey: false,
        ctrlKey: true,
        shiftKey: true,
      })
    ).toBe('background');
  });

  test('only opens chat split for foreground send', () => {
    expect(shouldOpenChatSplit('foreground')).toBe(true);
    expect(shouldOpenChatSplit(undefined)).toBe(true);
    expect(shouldOpenChatSplit('background')).toBe(false);
  });
});
