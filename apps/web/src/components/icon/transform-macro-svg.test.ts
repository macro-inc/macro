import { describe, expect, it } from 'vitest';
import { transformMacroSvg } from './transform-macro-svg';

describe('transformMacroSvg', () => {
  it('strips HTML comments that break Solid JSX', () => {
    const svg = `<svg width="100%" height="100%"><!-- Asset 286 --><path d="M0 0"/></svg>`;

    expect(transformMacroSvg(svg)).toBe(`<svg><path d="M0 0"/></svg>`);
  });

  it('drops percent box attributes so Iconify can apply scale', () => {
    const svg = `<svg width="100%" height='100%' viewBox="0 0 18 18"/>`;

    expect(transformMacroSvg(svg)).toBe(`<svg viewBox="0 0 18 18"/>`);
  });

  it('leaves a comment-free SVG without percent boxes intact', () => {
    const svg = `<svg viewBox="0 0 18 18"><path d="M1 1"/></svg>`;

    expect(transformMacroSvg(svg)).toBe(svg);
  });
});
