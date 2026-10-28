import { fireEvent, render, screen } from '@solidjs/testing-library';
import userEvent from '@testing-library/user-event';
import { createSignal } from 'solid-js';
import { describe, expect, it, vi } from 'vitest';
import type { QueryAnswer } from '../core/query';
import { PlainAnswerDisplay } from '../tests/plain-answer-display';
import { ToolQueryResults } from './tool-query-results';

vi.mock('@solid-primitives/resize-observer', () => ({
  createElementSize: () => ({ width: 346, height: 300 }),
}));

const answer: QueryAnswer = {
  columns: [
    { name: 'Team', kind: 'text' },
    { name: 'Tickets', kind: 'number' },
  ],
  rows: [
    [
      { type: 'text', value: 'Support' },
      { type: 'number', value: 12 },
    ],
    [
      { type: 'text', value: 'Sales' },
      { type: 'number', value: 4 },
    ],
  ],
  rowIds: [],
  readTables: [],
  readDatabaseIds: [],
  truncatedTables: [],
};

describe('native chat database answers', () => {
  it('opens the requested chart and lets the reader override it', async () => {
    const rendered = render(() => (
      <PlainAnswerDisplay>
        <ToolQueryResults
          showSql={false}
          answer={answer}
          sql="SELECT team, count FROM tickets"
          preferredDisplay="bar"
        />
      </PlainAnswerDisplay>
    ));
    expect(rendered.getByRole('img', { name: /Tickets by Team/ })).toBeTruthy();
    await fireEvent.keyDown(
      rendered.getByRole('button', { name: /Display database results/ }),
      { key: 'ArrowDown' }
    );
    await userEvent.click(
      await screen.findByRole('option', { name: /^Table$/ })
    );
    expect(rendered.getByRole('table').textContent).toContain('Support12');
    rendered.unmount();
  });

  it('falls back to a table when the requested chart cannot represent the result', () => {
    const textOnly: QueryAnswer = {
      ...answer,
      columns: [{ name: 'Name', kind: 'text' }],
      rows: [
        [{ type: 'text', value: 'Ada' }],
        [{ type: 'text', value: 'Grace' }],
      ],
    };
    const rendered = render(() => (
      <PlainAnswerDisplay>
        <ToolQueryResults
          showSql={false}
          answer={textOnly}
          sql="SELECT name FROM customers"
          preferredDisplay="bar"
        />
      </PlainAnswerDisplay>
    ));
    expect(rendered.getByRole('table').textContent).toContain('Ada');
    expect(rendered.queryByRole('img')).toBeNull();
    rendered.unmount();
  });

  it('switches real query data between table and compatible charts', async () => {
    const rendered = render(() => (
      <PlainAnswerDisplay>
        <ToolQueryResults
          showSql
          answer={answer}
          sql="SELECT team, count(*) AS Tickets FROM tickets GROUP BY team"
        />
      </PlainAnswerDisplay>
    ));
    expect(rendered.getByRole('table').textContent).toContain('Support12');
    await fireEvent.keyDown(
      rendered.getByRole('button', { name: /Display database results/ }),
      { key: 'ArrowDown' }
    );
    await userEvent.click(
      await screen.findByRole('option', { name: 'Bar chart' })
    );
    expect(rendered.getByRole('img', { name: /Tickets by Team/ })).toBeTruthy();
    expect(rendered.getByText('View data')).toBeTruthy();
    expect(rendered.getByText('View SQL')).toBeTruthy();
    rendered.unmount();
  });

  it('only offers a table for text-only results and recovers when streamed result shape changes', async () => {
    const [value, setValue] = createSignal(answer);
    const rendered = render(() => (
      <PlainAnswerDisplay>
        <ToolQueryResults
          showSql={false}
          answer={value()}
          sql="SELECT name FROM customers"
        />
      </PlainAnswerDisplay>
    ));
    await fireEvent.keyDown(
      rendered.getByRole('button', { name: /Display database results/ }),
      { key: 'ArrowDown' }
    );
    await userEvent.click(
      await screen.findByRole('option', { name: 'Pie chart' })
    );
    setValue({
      ...answer,
      columns: [{ name: 'Customer', kind: 'text' }],
      rows: [
        [{ type: 'text', value: 'Acme' }],
        [{ type: 'text', value: 'Macro' }],
      ],
    });
    expect(rendered.queryByRole('img')).toBeNull();
    expect(rendered.getByRole('table').textContent).toContain('Acme');
    await fireEvent.keyDown(
      rendered.getByRole('button', { name: /Display database results/ }),
      { key: 'ArrowDown' }
    );
    expect(screen.queryByRole('option', { name: /chart/ })).toBeNull();
    rendered.unmount();
  });
});

describe('native chat database answers with SQL hidden', () => {
  it('shows the result without the statement', () => {
    const rendered = render(() => (
      <PlainAnswerDisplay>
        <ToolQueryResults
          showSql={false}
          answer={answer}
          sql="SELECT team, count FROM tickets"
        />
      </PlainAnswerDisplay>
    ));
    expect(rendered.getByRole('table').textContent).toContain('Support12');
    expect(rendered.queryByText('View SQL')).toBeNull();
    expect(rendered.container.textContent).not.toContain('SELECT');
    rendered.unmount();
  });
});
