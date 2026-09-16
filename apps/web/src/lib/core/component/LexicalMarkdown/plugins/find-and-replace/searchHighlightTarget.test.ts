// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { resolveSearchHighlightRanges } from './searchHighlightTarget';

function mentionChip(title: string, collapsed = false): HTMLElement {
  const root = document.createElement('span');
  root.setAttribute('data-document-mention', 'true');
  const icon = document.createElement('span');
  icon.appendChild(document.createElement('svg'));
  root.appendChild(icon);
  if (!collapsed) {
    const name = document.createElement('span');
    name.setAttribute('data-document-name', title);
    name.appendChild(document.createTextNode(title));
    root.appendChild(name);
  }
  document.body.appendChild(root);
  return root;
}

describe('resolveSearchHighlightRanges', () => {
  it('highlights the matching substring inside a task chip title', () => {
    const chip = mentionChip('Fix login bug');
    const ranges = resolveSearchHighlightRanges(chip, {
      start: 4,
      end: 9,
      isReplace: true,
    });

    expect(ranges).toHaveLength(1);
    expect(ranges[0]?.startContainer.textContent).toBe('Fix login bug');
    expect(ranges[0]?.startOffset).toBe(4);
    expect(ranges[0]?.endOffset).toBe(9);
  });

  it('falls back to the whole chip when the title is collapsed', () => {
    const chip = mentionChip('Fix login bug', true);
    const ranges = resolveSearchHighlightRanges(chip, {
      start: 0,
      end: 13,
      isReplace: true,
    });

    expect(ranges).toHaveLength(1);
    expect(ranges[0]?.startContainer).toBe(chip.parentNode);
    expect(ranges[0]?.endContainer).toBe(chip.parentNode);
  });

  it('uses text-node offsets for ordinary editor text', () => {
    const wrapper = document.createElement('span');
    const text = document.createTextNode('Please review today');
    wrapper.appendChild(text);
    document.body.appendChild(wrapper);

    const ranges = resolveSearchHighlightRanges(wrapper, {
      start: 8,
      end: 14,
      isReplace: true,
    });

    expect(ranges).toHaveLength(1);
    expect(ranges[0]?.startContainer).toBe(text);
    expect(ranges[0]?.startOffset).toBe(8);
    expect(ranges[0]?.endOffset).toBe(14);
  });
});
