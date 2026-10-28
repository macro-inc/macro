import { describe, expect, it } from 'vitest';
import type { View } from '../schema';
import { titledWidgets } from './view-title';

const list = (title?: string) => ({
  type: 'list' as const,
  title,
  source: { kind: 'items' as const, entities: [] },
});

describe('a view title', () => {
  it('is not printed again above a card that already says it', () => {
    const view: View = {
      title: 'Recent documents',
      widgets: [list('Recent documents')],
    };
    expect(titledWidgets(view)).toEqual({
      widgets: [list('Recent documents')],
    });
  });

  it('names a lone card that has no title of its own', () => {
    const view: View = { title: 'Recent documents', widgets: [list()] };
    expect(titledWidgets(view)).toEqual({
      widgets: [list('Recent documents')],
    });
  });

  it('stays above a view of several parts', () => {
    const view: View = {
      title: 'Your week',
      widgets: [list(), { type: 'md', markdown: 'Busy one.' }],
    };
    expect(titledWidgets(view)).toBe(view);
  });

  it('stays above prose, which has no header', () => {
    const view: View = {
      title: 'Summary',
      widgets: [{ type: 'md', markdown: 'Hi' }],
    };
    expect(titledWidgets(view)).toBe(view);
  });
});
