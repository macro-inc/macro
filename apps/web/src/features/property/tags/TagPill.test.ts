import { describe, expect, it, vi } from 'vitest';
import { tagPillClasses } from './TagPill';

vi.mock('./TagDot', () => ({ TagDot: () => null }));
vi.mock('./TagPicker', () => ({ TagPicker: () => null }));

describe('tagPillClasses', () => {
  it('uses the outline small Badge contract', () => {
    const classes = tagPillClasses().split(' ');

    expect(classes).toContain('h-6');
    expect(classes).toContain('text-xs');
    expect(classes).toContain('border-edge-muted');
    expect(classes).toContain('rounded-full');
  });

  it('merges layout constraints supplied by a tag owner', () => {
    const classes = tagPillClasses('m-px max-w-[14ch] gap-1.5');

    expect(classes).toContain('m-px');
    expect(classes).toContain('max-w-[14ch]');
    expect(classes).toContain('gap-1.5');
  });
});
