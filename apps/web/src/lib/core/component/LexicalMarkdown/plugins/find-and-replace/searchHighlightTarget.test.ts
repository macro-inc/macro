// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { resolveSearchHighlightRanges } from './searchHighlightTarget';

function mentionChip(
  attr: string,
  title: string,
  options: { collapsed?: boolean; prefix?: string } = {}
): HTMLElement {
  const root = document.createElement('span');
  root.setAttribute(attr, 'true');
  const icon = document.createElement('span');
  icon.appendChild(document.createElement('svg'));
  root.appendChild(icon);
  if (!options.collapsed) {
    const name = document.createElement('span');
    name.appendChild(
      document.createTextNode(`${options.prefix ?? ''}${title}`)
    );
    root.appendChild(name);
  }
  document.body.appendChild(root);
  return root;
}

describe('resolveSearchHighlightRanges', () => {
  it('highlights the matching substring inside a task chip title', () => {
    const chip = mentionChip('data-document-mention', 'Fix login bug');
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

  it('highlights a user mention using searchable offsets that include @', () => {
    const chip = mentionChip('data-user-mention', 'Wolf UniqueHandle', {
      prefix: '@',
    });
    const ranges = resolveSearchHighlightRanges(chip, {
      start: 1,
      end: 5,
      isReplace: true,
    });

    expect(ranges).toHaveLength(1);
    expect(ranges[0]?.startContainer.textContent).toBe('@Wolf UniqueHandle');
    expect(ranges[0]?.startOffset).toBe(1);
    expect(ranges[0]?.endOffset).toBe(5);
  });

  it('shifts a skill slash that is not in searchable text', () => {
    const chip = mentionChip('data-document-mention', 'draft-skill', {
      prefix: '/',
    });
    const ranges = resolveSearchHighlightRanges(chip, {
      start: 0,
      end: 5,
      isReplace: true,
    });

    expect(ranges).toHaveLength(1);
    expect(ranges[0]?.startContainer.textContent).toBe('/draft-skill');
    expect(ranges[0]?.startOffset).toBe(1);
    expect(ranges[0]?.endOffset).toBe(6);
  });

  it('does not shift a group mention whose text already includes @', () => {
    const chip = mentionChip('data-group-mention', '@refs');
    const ranges = resolveSearchHighlightRanges(chip, {
      start: 0,
      end: 5,
      isReplace: true,
    });

    expect(ranges).toHaveLength(1);
    expect(ranges[0]?.startContainer.textContent).toBe('@refs');
    expect(ranges[0]?.startOffset).toBe(0);
    expect(ranges[0]?.endOffset).toBe(5);
  });

  it('falls back to the whole chip when the title is collapsed', () => {
    const chip = mentionChip('data-document-mention', 'Fix login bug', {
      collapsed: true,
    });
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
