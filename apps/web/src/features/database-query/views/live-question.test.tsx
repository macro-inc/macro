import { render } from '@solidjs/testing-library';
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
