import { showDatabaseSql } from '@core/constant/featureFlags';
import { Dialog } from '@kobalte/core/dialog';
import { fireEvent, render, screen, waitFor } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { QueryAnswer, QueryFailure } from '../core/query';
import { PlainAnswerDisplay } from '../tests/plain-answer-display';
import { LiveQuestion } from './live-question';

vi.mock('@solid-primitives/resize-observer', () => ({
  createElementSize: () => ({ width: 346, height: 300 }),
}));

describe('live database charts', () => {
  it('hides cached chart data after a permission error and never labels an unavailable answer live', () => {
    const [error, setError] = createSignal<QueryFailure>();
    const rendered = render(() => (
      <PlainAnswerDisplay>
        <LiveQuestion
          source={{
            queryId: 'tasks-by-status',
            prompt: 'Tasks by status',
            displayMode: 'bar',
            chart: { x: 'Status', y: ['Count'] },
          }}
          answer={{
            columns: [
              { name: 'Status', kind: 'text' },
              { name: 'Count', kind: 'number' },
            ],
            rows: [
              [
                { type: 'text', value: 'Private work' },
                { type: 'number', value: 5 },
              ],
            ],
            rowIds: [],
            readTables: [],
            readDatabaseIds: [],
            truncatedTables: [],
          }}
          error={error()}
          loading={false}
          onRefresh={vi.fn()}
        />
      </PlainAnswerDisplay>
    ));
    expect(rendered.getByRole('img')).toBeTruthy();
    setError({
      kind: 'question',
      error: { code: 'FORBIDDEN', message: 'Forbidden' },
    });
    expect(rendered.queryByRole('img')).toBeNull();
    expect(rendered.queryByText('Private work')).toBeNull();
    expect(rendered.queryByText('Live · visible to you')).toBeNull();
    expect(rendered.getByRole('alert').textContent).toBe('Answer unavailable');
    rendered.unmount();
  });
  it('renders a saved chart as a block and updates when fresh permitted results arrive', async () => {
    const result = (value: number): QueryAnswer => ({
      columns: [
        { name: 'Status', kind: 'text' },
        { name: 'Count', kind: 'number' },
      ],
      rows: [
        [
          { type: 'text', value: 'Done' },
          { type: 'number', value },
        ],
      ],
      rowIds: [],
      readTables: [],
      readDatabaseIds: [],
      truncatedTables: [],
    });
    const [answer, setAnswer] = createSignal(result(5));
    const rendered = render(() => (
      <PlainAnswerDisplay>
        <LiveQuestion
          source={{
            queryId: 'tasks-by-status',
            prompt: 'Tasks by status',
            displayMode: 'bar',
            chart: { x: 'Status', y: ['Count'] },
          }}
          answer={answer()}
          loading={false}
          onRefresh={vi.fn()}
        />
      </PlainAnswerDisplay>
    ));
    expect(
      rendered.getByRole('img', { name: 'Count by Status. Bar chart.' })
    ).toBeTruthy();
    // Plot's element reports the scales it drew.
    const valueDomain = () =>
      rendered
        .getByRole('img')
        .querySelector<
          SVGSVGElement & { scale(name: 'x'): { domain: number[] } }
        >('svg.macro-chart')
        ?.scale('x').domain;
    await waitFor(() => expect(valueDomain()).toEqual([0, 5]));
    setAnswer(result(8));
    await waitFor(() => expect(valueDomain()).toEqual([0, 8]));
    expect(rendered.getByRole('button', { name: 'Details' })).toBeTruthy();
    rendered.unmount();
  });
});

describe('answer titles', () => {
  it('keeps a new question focused inside a modal composer until dismissed', async () => {
    const scrollTo = vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
    const discard = vi.fn();
    const rendered = render(() => (
      <Dialog open>
        <Dialog.Portal>
          <Dialog.Content class="portal-scope">
            <Dialog.Title>Document composer</Dialog.Title>
            <PlainAnswerDisplay>
              <LiveQuestion
                source={{ queryId: '', prompt: '', displayMode: 'scalar' }}
                loading={false}
                onRefresh={vi.fn()}
                onDiscard={discard}
                editor={() => <textarea aria-label="Ask your database" />}
              />
            </PlainAnswerDisplay>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog>
    ));
    const field = await screen.findByLabelText('Ask your database');
    await waitFor(() => expect(document.activeElement).toBe(field));
    expect(field.closest('.portal-scope')).not.toBeNull();
    await fireEvent.input(field, { target: { value: 'How many tasks?' } });
    expect(discard).not.toHaveBeenCalled();
    await fireEvent.click(
      screen.getByRole('button', { name: 'Close database answer' })
    );
    expect(discard).toHaveBeenCalledOnce();
    rendered.unmount();
    scrollTo.mockRestore();
  });

  it.each(['scalar', 'table'] as const)(
    'renames a %s answer inline without changing its question',
    async (displayMode) => {
      const onRename = vi.fn();
      const rendered = render(() => (
        <PlainAnswerDisplay>
          <LiveQuestion
            source={{
              queryId: 'twelve',
              prompt: 'Please tell me how many tickets we have right now',
              title: 'Open tickets',
              displayMode,
            }}
            loading={false}
            onRefresh={vi.fn()}
            onRename={onRename}
          />
        </PlainAnswerDisplay>
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
      <PlainAnswerDisplay>
        <LiveQuestion
          source={{
            queryId: 'one',
            prompt: 'Question',
            title: 'Tickets',
            displayMode: 'table',
          }}
          loading={false}
          onRefresh={vi.fn()}
          onRename={onRename}
        />
      </PlainAnswerDisplay>
    ));
    await fireEvent.dblClick(rendered.getByText('Tickets'));
    await fireEvent.input(rendered.getByRole('textbox'), {
      target: { value: 'Changed' },
    });
    await fireEvent.keyDown(rendered.getByRole('textbox'), { key: 'Escape' });
    expect(onRename).not.toHaveBeenCalled();
    rendered.unmount();
    const reader = render(() => (
      <PlainAnswerDisplay>
        <LiveQuestion
          source={{
            queryId: 'one',
            prompt: 'Question',
            title: 'Tickets',
            displayMode: 'table',
          }}
          loading={false}
          onRefresh={vi.fn()}
        />
      </PlainAnswerDisplay>
    ));
    await fireEvent.dblClick(reader.getByText('Tickets'));
    expect(reader.queryByRole('textbox')).toBeNull();
    reader.unmount();
  });

  it('discards a never-saved answer when its question editor is dismissed', async () => {
    const discard = vi.fn();
    const rendered = render(() => (
      <PlainAnswerDisplay>
        <LiveQuestion
          source={{ queryId: '', prompt: '', displayMode: 'table' }}
          loading={false}
          onRefresh={vi.fn()}
          onDiscard={discard}
          editor={() => <textarea aria-label="Ask your database" />}
        />
      </PlainAnswerDisplay>
    ));
    const field = await screen.findByLabelText('Ask your database');
    await fireEvent.keyDown(field, { key: 'Escape' });
    expect(discard).toHaveBeenCalledOnce();
    rendered.unmount();
  });

  it('keeps a saved answer when its question editor is dismissed', async () => {
    const discard = vi.fn();
    const rendered = render(() => (
      <PlainAnswerDisplay>
        <LiveQuestion
          source={{
            queryId: 'one',
            prompt: 'How many RSVPs?',
            title: 'RSVP Counts',
            displayMode: 'table',
          }}
          loading={false}
          onRefresh={vi.fn()}
          onDiscard={discard}
          editor={() => <textarea aria-label="Ask your database" />}
        />
      </PlainAnswerDisplay>
    ));
    await fireEvent.click(rendered.getByRole('button', { name: 'Details' }));
    const prompt = await screen.findByLabelText('Ask your database');
    await fireEvent.keyDown(prompt, { key: 'Escape' });
    expect(discard).not.toHaveBeenCalled();
    rendered.unmount();
  });

  it('opens the existing question editor from saved block details', async () => {
    const rendered = render(() => (
      <PlainAnswerDisplay>
        <LiveQuestion
          source={{
            queryId: 'one',
            prompt: 'How many RSVPs?',
            title: 'RSVP Counts',
            displayMode: 'table',
          }}
          loading={false}
          onRefresh={vi.fn()}
          editor={() => <textarea aria-label="Ask your database" />}
        />
      </PlainAnswerDisplay>
    ));
    expect(
      rendered.queryByRole('button', { name: 'Edit question' })
    ).toBeNull();
    await fireEvent.click(rendered.getByRole('button', { name: 'Details' }));
    expect(await screen.findByLabelText('Ask your database')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Refresh' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Edit question' })).toBeNull();
    rendered.unmount();
  });

  it('opens the answer details from an inline answer', async () => {
    const rendered = render(() => (
      <PlainAnswerDisplay>
        <LiveQuestion
          source={{
            queryId: 'one',
            prompt: 'How many RSVPs?',
            title: 'RSVPs',
            displayMode: 'scalar',
          }}
          answer={{
            columns: [{ name: 'count', kind: 'number' }],
            rows: [[{ type: 'number', value: 6 }]],
            rowIds: [],
            readTables: [],
            readDatabaseIds: [],
            truncatedTables: [],
          }}
          loading={false}
          onRefresh={vi.fn()}
          editor={() => <textarea aria-label="Ask your database" />}
        />
      </PlainAnswerDisplay>
    ));
    await fireEvent.click(rendered.getByRole('button', { name: /RSVPs/ }));
    expect(await screen.findByLabelText('Ask your database')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Edit question' })).toBeNull();
    rendered.unmount();
  });
});

describe('answer details', () => {
  afterEach(() => {
    showDatabaseSql.enabled = false;
  });
  const details = () => (
    <PlainAnswerDisplay>
      <LiveQuestion
        source={{
          queryId: 'open-tickets',
          prompt: 'How many open tickets?',
          displayMode: 'table',
        }}
        answer={{
          columns: [{ name: 'Count', kind: 'number' }],
          rows: [[{ type: 'number', value: 4 }]],
          rowIds: [],
          readTables: [],
          readDatabaseIds: [],
          truncatedTables: [],
        }}
        loading={false}
        onRefresh={vi.fn()}
        sql={() => 'SELECT COUNT(*) FROM "Tickets"'}
      />
    </PlainAnswerDisplay>
  );

  it('offers View SQL when SQL is shown', async () => {
    showDatabaseSql.enabled = true;
    const rendered = render(details);
    fireEvent.click(rendered.getByRole('button', { name: 'Details' }));
    await fireEvent.click(await screen.findByText('View SQL'));
    expect(document.body.textContent).toContain('SELECT COUNT(*)');
    rendered.unmount();
  });

  it('hides View SQL and the statement when SQL is hidden', async () => {
    const rendered = render(details);
    fireEvent.click(rendered.getByRole('button', { name: 'Details' }));
    expect(await screen.findByText('How many open tickets?')).toBeTruthy();
    expect(screen.queryByText('View SQL')).toBeNull();
    expect(document.body.textContent).not.toContain('SELECT');
    rendered.unmount();
  });

  it('words an unavailable answer plainly', async () => {
    const rendered = render(() => (
      <PlainAnswerDisplay>
        <LiveQuestion
          source={{
            queryId: 'prices',
            prompt: 'Total price',
            displayMode: 'table',
          }}
          error={{
            kind: 'engine',
            error: {
              stage: 'resolve',
              kind: 'unknownColumn',
              name: 'Price',
              table: 'Shop.Items',
              suggestion: null,
            },
            message: 'unknown column "Price" in "Shop"."Items"',
          }}
          loading={false}
          onRefresh={vi.fn()}
        />
      </PlainAnswerDisplay>
    ));
    fireEvent.click(rendered.getByRole('button', { name: 'Details' }));
    expect(
      (await screen.findAllByRole('alert')).map((alert) => alert.textContent)
    ).toContain(
      "This answer couldn't be computed: the column Price no longer exists."
    );
    rendered.unmount();
  });
});
