import { fireEvent, render, screen, waitFor } from '@solidjs/testing-library';
import type { JSX } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fixture = vi.hoisted(() => ({
  flag: { enabled: true, loading: false },
  entities: [] as { id: string }[],
  hasNextPage: false,
  countError: null as Error | null,
  source: {
    answer: undefined as unknown,
    error: undefined as unknown,
  },
}));

vi.mock('@app/lib/analytics/posthog', () => ({
  useFeatureFlag: () => () => ({ ...fixture.flag, payload: undefined }),
}));

vi.mock('@queries/soup/items', () => ({
  useSoupAstItemsQuery: () => ({
    isPending: false,
    error: fixture.countError,
    data: fixture.countError ? undefined : { entities: fixture.entities },
    hasNextPage: fixture.hasNextPage,
  }),
}));

vi.mock('./List', () => ({ compileQuery: () => ({}) }));

vi.mock('@app/features/database-query/queries/app-query-source', () => ({
  createSavedQuestionSource: () => ({
    answer: () => fixture.source.answer,
    error: () => fixture.source.error,
    loading: () => false,
  }),
}));

vi.mock('@app/features/database-query/answer-display', async () => {
  const { PlainAnswerDisplay } = await import(
    '@app/features/database-query/tests/plain-answer-display'
  );
  return {
    AppAnswerDisplay: (props: { children: JSX.Element }) => (
      <PlainAnswerDisplay>{props.children}</PlainAnswerDisplay>
    ),
  };
});

import { Grid } from './Grid';
import { Stat } from './Stat';
import { Tabs } from './Tabs';

const series = {
  columns: [
    { name: 'day', kind: 'text' },
    { name: 'invites', kind: 'number' },
  ],
  rows: [
    [
      { type: 'text', value: 'Mon' },
      { type: 'number', value: 4 },
    ],
    [
      { type: 'text', value: 'Tue' },
      { type: 'number', value: 7 },
    ],
    [
      { type: 'text', value: 'Wed' },
      { type: 'number', value: 5 },
    ],
  ],
  rowIds: [],
  readTables: [],
  readDatabaseIds: [],
  truncatedTables: [],
};

// The tab row measures itself for its scroll buttons; jsdom has no observer.
vi.stubGlobal(
  'ResizeObserver',
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
);

beforeEach(() => {
  fixture.flag = { enabled: true, loading: false };
  fixture.entities = [];
  fixture.hasNextPage = false;
  fixture.countError = null;
  fixture.source = { answer: undefined, error: undefined };
});

afterEach(() => {
  document.body.innerHTML = '';
});

describe('dashboard panes', () => {
  it('shows the last row of a series with its change from the row before', () => {
    fixture.source.answer = series;
    render(() => (
      <Stat
        label="Invites"
        source={{ kind: 'query', queryId: 'query-1' }}
        delta
        sparkline
      />
    ));
    expect(screen.getByText('5')).toBeTruthy();
    expect(screen.getByText('-2')).toBeTruthy();
    expect(screen.getByRole('img', { name: 'Trend' })).toBeTruthy();
  });

  it('says No access for a question the viewer cannot read', () => {
    fixture.source.error = {
      kind: 'question',
      error: { code: 'NOT_FOUND', message: 'missing' },
    };
    render(() => (
      <Stat label="Invites" source={{ kind: 'query', queryId: 'query-1' }} />
    ));
    expect(screen.getByText('No access')).toBeTruthy();
  });

  it('counts the matches it read, and says when there are more', () => {
    fixture.entities = Array.from({ length: 42 }, (_, index) => ({
      id: `item-${index}`,
    }));
    render(() => (
      <Stat label="Open tasks" source={{ kind: 'count', query: {} }} />
    ));
    expect(screen.getByText('42')).toBeTruthy();
    document.body.innerHTML = '';

    fixture.entities = Array.from({ length: 100 }, (_, index) => ({
      id: `item-${index}`,
    }));
    fixture.hasNextPage = true;
    render(() => (
      <Stat label="Open tasks" source={{ kind: 'count', query: {} }} />
    ));
    expect(screen.getByText('100+')).toBeTruthy();
  });

  it('says a count failed instead of showing zero', () => {
    fixture.countError = new Error('soup failed');
    render(() => (
      <Stat label="Open tasks" source={{ kind: 'count', query: {} }} />
    ));
    expect(screen.getByText('This pane couldn’t be loaded.')).toBeTruthy();
    expect(screen.queryByText('0')).toBeNull();
  });

  it('shows an unchanged value as +0', () => {
    fixture.source.answer = {
      ...series,
      rows: [series.rows[0], series.rows[0]],
    };
    render(() => (
      <Stat
        label="Invites"
        source={{ kind: 'query', queryId: 'query-1' }}
        delta
      />
    ));
    expect(screen.getByText('+0')).toBeTruthy();
  });

  it('mounts a page only once its tab is chosen', async () => {
    render(() => (
      <Tabs
        tabs={[
          { label: 'Monitor', children: [{ type: 'md', markdown: 'one' }] },
          { label: 'Work', children: [{ type: 'md', markdown: 'two' }] },
        ]}
        render={(child) => (
          <p>{child.type === 'md' ? child.markdown : child.type}</p>
        )}
      />
    ));
    expect(screen.getByText('one')).toBeTruthy();
    expect(screen.queryByText('two')).toBeNull();
    const work = screen.getByRole('tab', { name: 'Work' });
    fireEvent.pointerDown(work, { button: 0, pointerType: 'mouse' });
    fireEvent.mouseDown(work, { button: 0 });
    fireEvent.click(work);
    expect(await screen.findByText('two')).toBeTruthy();
    await waitFor(() =>
      expect(
        screen
          .getByRole('tab', { name: 'Monitor' })
          .getAttribute('aria-selected')
      ).toBe('false')
    );
  });

  it('draws a neutral placeholder instead of layouts and panes when the flag is off', () => {
    fixture.flag = { enabled: false, loading: false };
    render(() => (
      <Grid
        columns={2}
        render={() => <p>child</p>}
        children={[{ type: 'md', markdown: 'hidden' }]}
      />
    ));
    expect(
      screen.getByText('This part of the view isn’t available.')
    ).toBeTruthy();
    expect(screen.queryByText('child')).toBeNull();
  });

  it('draws nothing while the flag loads, never the off path', () => {
    fixture.flag = { enabled: false, loading: true };
    const { container } = render(() => (
      <Stat label="Open tasks" source={{ kind: 'count', query: {} }} />
    ));
    expect(container.textContent).toBe('');
  });
});
