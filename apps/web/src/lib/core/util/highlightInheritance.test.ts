import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  inheritsHighlights,
  markHighlightInheritance,
  NO_HIGHLIGHT_INHERITANCE_CLASS,
} from './highlightInheritance';

const html = () => document.documentElement;

describe('markHighlightInheritance', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    html().classList.remove(NO_HIGHLIGHT_INHERITANCE_CLASS);
  });

  it('turns on the per-element fallback where a child does not inherit the probe tint', () => {
    markHighlightInheritance();
    expect(html().classList.contains(NO_HIGHLIGHT_INHERITANCE_CLASS)).toBe(
      true
    );
  });

  it('leaves it off where the child inherits the probe tint', () => {
    html().classList.add(NO_HIGHLIGHT_INHERITANCE_CLASS);
    const real = window.getComputedStyle;
    vi.spyOn(window, 'getComputedStyle').mockImplementation((el, pseudo) =>
      pseudo === '::selection'
        ? ({ backgroundColor: 'rgb(1, 2, 3)' } as CSSStyleDeclaration)
        : real(el, pseudo)
    );
    markHighlightInheritance();
    expect(html().classList.contains(NO_HIGHLIGHT_INHERITANCE_CLASS)).toBe(
      false
    );
  });

  it('removes the probe from the document', () => {
    const before = document.documentElement.outerHTML;
    inheritsHighlights();
    expect(document.documentElement.outerHTML).toBe(before);
  });
});
