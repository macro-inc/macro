import { afterEach, describe, expect, it } from 'vitest';
import { cloneDragPreview } from './drag-preview';

afterEach(() => {
  document.body.replaceChildren();
});

describe('drag preview surfaces', () => {
  it('keeps the source background when moved over a different surface', () => {
    document.body.innerHTML = `
      <style>
        [data-source] article { background-color: rgb(32, 34, 38); }
        [data-overlay] article { background-color: rgb(240, 242, 246); }
      </style>
      <section data-source><article style="opacity: 0.35">Card</article></section>
      <section data-overlay></section>
    `;
    const card = document.querySelector('article')!;
    const overlay = document.querySelector('[data-overlay]')!;
    const background = getComputedStyle(card).backgroundColor;
    const preview = cloneDragPreview(card, 'data-preview');

    overlay.append(preview);

    expect(getComputedStyle(preview).backgroundColor).toBe(background);
    expect(getComputedStyle(preview).opacity).toBe('1');
    expect(getComputedStyle(card).opacity).toBe('0.35');
  });

  it('keeps source surface tokens for cards inside a dragged lane', () => {
    document.body.innerHTML = `
      <style>
        [data-source] section {
          --color-surface: rgb(32, 34, 38);
          --color-inset: rgb(24, 26, 30);
        }
        [data-overlay] section {
          --color-surface: rgb(240, 242, 246);
          --color-inset: rgb(232, 234, 238);
        }
      </style>
      <div data-source><section><article>Card</article></section></div>
      <div data-overlay></div>
    `;
    const lane = document.querySelector('section')!;
    const overlay = document.querySelector('[data-overlay]')!;
    const source = getComputedStyle(lane);
    const preview = cloneDragPreview(lane, 'data-preview');

    overlay.append(preview);

    expect(getComputedStyle(preview).getPropertyValue('--color-surface')).toBe(
      source.getPropertyValue('--color-surface')
    );
    expect(getComputedStyle(preview).getPropertyValue('--color-inset')).toBe(
      source.getPropertyValue('--color-inset')
    );
  });
});
