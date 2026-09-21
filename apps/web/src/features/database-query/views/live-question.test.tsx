import { fireEvent, render } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { describe, expect, it, vi } from 'vitest';
import type { QueryAnswer } from '../core/query';
import { LiveQuestion } from './live-question';

vi.mock('@solid-primitives/resize-observer', () => ({
  createElementSize: () => ({ width: 346, height: 300 }),
}));

describe('live database charts', () => {
  it('hides cached chart data after a permission error and never labels an unavailable answer live', () => {
    const [error, setError] = createSignal<Error>();
    const rendered = render(() => (
      <LiveQuestion
        source={{
          sql: 'SELECT status AS Status, COUNT(*) AS Count FROM projects GROUP BY status',
          prompt: 'Tasks by status',
          displayMode: 'bar',
          chart: { x: 'Status', y: ['Count'] },
        }}
        answer={{
          results: [
            {
              columns: [
                { name: 'Status', entity_type: null },
                { name: 'Count', entity_type: null },
              ],
              rows: [['Private work', 5]],
            },
          ],
          read_tables: [],
          read_versions: {},
          truncated_tables: [],
        }}
        error={error()}
        loading={false}
        onRefresh={vi.fn()}
      />
    ));
    expect(rendered.getByRole('img')).toBeTruthy();
    setError(new Error('Forbidden'));
    expect(rendered.queryByRole('img')).toBeNull();
    expect(rendered.queryByText('Private work')).toBeNull();
    expect(rendered.queryByText('Live · visible to you')).toBeNull();
    expect(rendered.getByRole('alert').textContent).toBe('Answer unavailable');
    rendered.unmount();
  });
  it('renders a saved chart as a block and updates when fresh permitted results arrive', () => {
    const result = (value: number): QueryAnswer => ({
      results: [
        {
          columns: [
            { name: 'Status', entity_type: null },
            { name: 'Count', entity_type: null },
          ],
          rows: [['Done', value]],
        },
      ],
      read_tables: [],
      read_versions: {},
      truncated_tables: [],
    });
    const [answer, setAnswer] = createSignal(result(5));
    const rendered = render(() => (
      <LiveQuestion
        source={{
          sql: 'SELECT status AS Status, COUNT(*) AS Count FROM projects GROUP BY status',
          prompt: 'Tasks by status',
          displayMode: 'bar',
          chart: { x: 'Status', y: ['Count'] },
        }}
        answer={answer()}
        loading={false}
        onRefresh={vi.fn()}
      />
    ));
    expect(
      rendered.getByRole('img', { name: 'Count by Status. Bar chart.' })
    ).toBeTruthy();
    expect(rendered.getByRole('img').textContent).toContain('5');
    setAnswer(result(8));
    expect(rendered.getByRole('img').textContent).toContain('8');
    expect(rendered.getByRole('button', { name: 'Details' })).toBeTruthy();
    rendered.unmount();
  });
});

describe('answer titles', () => {
  it.each(['scalar', 'table'] as const)(
    'renames a %s answer inline without changing its question',
    async (displayMode) => {
      const onRename = vi.fn();
      const rendered = render(() => (
        <LiveQuestion
          source={{
            sql: 'SELECT 12',
            prompt: 'Please tell me how many tickets we have right now',
            title: 'Open tickets',
            displayMode,
          }}
          loading={false}
          onRefresh={vi.fn()}
          onRename={onRename}
        />
      ));
      // Lexical handles input at its editor root before Solid's document-level
      // delegated listener. Inline fields must still receive their own input.
      rendered.container.addEventListener('input', (event) =>
        event.stopPropagation()
      );
      await fireEvent.dblClick(rendered.getByText('Open tickets'));
      const input = rendered.getByRole('textbox', { name: 'Answer title' });
      await fireEvent.input(input, { target: { value: 'Support queue' } });
      await fireEvent.keyDown(input, { key: 'Enter' });
      expect(onRename).toHaveBeenCalledExactlyOnceWith('Support queue');
      expect(rendered.queryByRole('textbox')).toBeNull();
      expect(rendered.queryByText('Live · visible to you')).toBeNull();
      rendered.unmount();
    }
  );
  it('cancels a rename with Escape and keeps a reader-only title inert', async () => {
    const onRename = vi.fn();
    const rendered = render(() => (
      <LiveQuestion
        source={{
          sql: 'SELECT 1',
          prompt: 'Question',
          title: 'Tickets',
          displayMode: 'table',
        }}
        loading={false}
        onRefresh={vi.fn()}
        onRename={onRename}
      />
    ));
    await fireEvent.dblClick(rendered.getByText('Tickets'));
    await fireEvent.input(rendered.getByRole('textbox'), {
      target: { value: 'Changed' },
    });
    await fireEvent.keyDown(rendered.getByRole('textbox'), { key: 'Escape' });
    expect(onRename).not.toHaveBeenCalled();
    rendered.unmount();
    const reader = render(() => (
      <LiveQuestion
        source={{
          sql: 'SELECT 1',
          prompt: 'Question',
          title: 'Tickets',
          displayMode: 'table',
        }}
        loading={false}
        onRefresh={vi.fn()}
      />
    ));
    await fireEvent.dblClick(reader.getByText('Tickets'));
    expect(reader.queryByRole('textbox')).toBeNull();
    reader.unmount();
  });
});
