import { describe, expect, it } from 'vitest';
import { railScrollToReveal } from './reveal-in-rail';

describe('railScrollToReveal', () => {
  it('leaves a tab that already shows where it is', () => {
    expect(
      railScrollToReveal({ left: 16, right: 216 }, { left: 40, right: 120 })
    ).toBe(0);
  });

  it('scrolls back to a tab cut off on the left', () => {
    expect(
      railScrollToReveal({ left: 16, right: 216 }, { left: -64, right: 36 })
    ).toBe(-80);
  });

  it('scrolls forward to a tab cut off on the right', () => {
    expect(
      railScrollToReveal({ left: 16, right: 216 }, { left: 180, right: 300 })
    ).toBe(84);
  });

  it('shows the start of a tab wider than the rail', () => {
    expect(
      railScrollToReveal({ left: 16, right: 116 }, { left: 60, right: 220 })
    ).toBe(44);
  });
});
