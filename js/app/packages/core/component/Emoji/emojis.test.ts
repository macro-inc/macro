import { describe, expect, it } from 'vitest';
import { resolveEmoji } from './emojis';

describe('resolveEmoji', () => {
  it('resolves canonical github shortcodes', () => {
    expect(resolveEmoji(':heart:')).toBe('❤️');
    expect(resolveEmoji(':fire:')).toBe('🔥');
    expect(resolveEmoji(':tada:')).toBe('🎉');
    expect(resolveEmoji(':cry:')).toBe('😢');
    expect(resolveEmoji(':sob:')).toBe('😭');
    expect(resolveEmoji(':joy:')).toBe('😂');
    expect(resolveEmoji(':100:')).toBe('💯');
  });

  it('is case insensitive', () => {
    expect(resolveEmoji(':TADA:')).toBe('🎉');
  });

  it('returns undefined for unknown names', () => {
    expect(resolveEmoji(':notanemoji:')).toBeUndefined();
  });

  // Reactions group by exact string equality, so the picker must emit forms
  // byte-identical to the quick-reaction literals hardcoded across the app.
  // Explicit escapes pin the canonical Unicode forms: no FE0F on thumbs
  // up/down and check mark, FE0F required on red heart.
  it('emits byte forms matching the hardcoded quick-reaction emojis', () => {
    expect(resolveEmoji(':heart:')).toBe('❤️');
    expect(resolveEmoji(':+1:')).toBe('\u{1f44d}');
    expect(resolveEmoji(':-1:')).toBe('\u{1f44e}');
    expect(resolveEmoji(':joy:')).toBe('\u{1f602}');
    expect(resolveEmoji(':rage:')).toBe('\u{1f621}');
    expect(resolveEmoji(':white_check_mark:')).toBe('✅');
  });
});
