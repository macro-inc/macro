import { fireEvent, render } from '@solidjs/testing-library';
import { describe, expect, it, vi } from 'vitest';
import { AppAnswerDisplay } from './answer-display';
import type { QueryAnswer } from './core/query';
import { ToolQueryResults } from './views/tool-query-results';

vi.mock('@property/hooks/usePropertyEntityDisplay', () => ({
  usePropertyEntityDisplay: (id: () => string, type: () => string) => ({
    name: () => (type() === 'USER' ? 'Ada Lovelace' : 'Launch plan'),
    icon: () => <span data-testid={`${type()}-${id()}-icon`} />,
  }),
}));
vi.mock('@core/component/UserIcon', () => ({
  UserIcon: (props: { id: string }) => (
    <span data-testid="person-icon" data-id={props.id} />
  ),
}));
vi.mock(
  '@core/component/LexicalMarkdown/component/menu/MentionsMenu/MentionsMenu',
  () => ({ MentionsMenu: () => null })
);
vi.mock(
  '@core/component/LexicalMarkdown/component/menu/MentionsMenu/utils/entityUtils',
  () => ({ getBlockNameFromEntity: () => 'md' })
);
vi.mock(
  '@core/component/LexicalMarkdown/component/core/StaticMarkdown',
  () => ({
    StaticMarkdown: (props: { markdown: string }) => (
      <span data-testid="markdown">{props.markdown}</span>
    ),
  })
);
const opened = vi.hoisted(() => ({
  split: vi.fn(),
  location: vi.fn(),
}));
vi.mock('@app/signal/splitLayout', () => ({
  globalSplitManager: () => ({ openWithSplit: opened.split }),
}));
vi.mock('@components/app/GlobalAppState', () => ({
  useGlobalBlockOrchestrator: () => ({
    getBlockHandle: async () => ({ goToLocationFromParams: opened.location }),
  }),
}));
vi.mock('@queries/storage/databases', () => ({
  useDatabasesQuery: () => ({
    isSuccess: true,
    data: [{ tables: [{ id: 'guests', database_id: 'offsite' }] }],
  }),
}));
vi.mock('./queries/answer-names', () => ({
  answerNames: () => () => () => undefined,
}));

describe('answers in the app', () => {
  it('draws people and documents with the database grid’s mentions', () => {
    const answer: QueryAnswer = {
      columns: [
        {
          name: 'Host',
          kind: 'entity',
          source: {
            markdown: false,
            options: [],
            tag: false,
            target: 'USER',
            relatedTable: null,
          },
        },
        {
          name: 'Plan',
          kind: 'entity',
          source: {
            markdown: false,
            options: [],
            tag: false,
            target: 'DOCUMENT',
            relatedTable: null,
          },
        },
      ],
      rows: [
        [
          { type: 'entities', value: ['macro|ada@macro.com'] },
          { type: 'entities', value: ['doc-1'] },
        ],
      ],
      rowIds: [],
      readTables: [],
      readDatabaseIds: [],
      truncatedTables: [],
    };
    const result = render(() => (
      <AppAnswerDisplay>
        <ToolQueryResults
          answer={answer}
          sql="SELECT owner, doc FROM launches"
          preferredDisplay="table"
          showSql={false}
        />
      </AppAnswerDisplay>
    ));
    const cells = Array.from(result.getByRole('table').querySelectorAll('td'));
    expect(cells.map((cell) => cell.textContent)).toEqual([
      'Ada Lovelace',
      'Launch plan',
    ]);
    expect(
      cells[0]
        .querySelector('[data-testid="person-icon"]')
        ?.getAttribute('data-id')
    ).toBe('macro|ada@macro.com');
    expect(
      cells[1].querySelector('[data-testid="DOCUMENT-doc-1-icon"]')
    ).toBeTruthy();
    result.unmount();
  });

  it('draws a row_id as a link that opens its row', async () => {
    const answer: QueryAnswer = {
      columns: [
        {
          name: 'row_id',
          kind: 'row',
          source: {
            markdown: false,
            options: [],
            tag: false,
            target: null,
            relatedTable: 'guests',
          },
        },
      ],
      rows: [[{ type: 'row', value: 'row-maria' }]],
      rowIds: ['row-maria'],
      readTables: ['guests'],
      readDatabaseIds: [],
      truncatedTables: [],
    };
    const result = render(() => (
      <AppAnswerDisplay>
        <ToolQueryResults
          answer={answer}
          sql="SELECT row_id FROM guests"
          preferredDisplay="table"
          showSql={false}
        />
      </AppAnswerDisplay>
    ));
    const link = result.getByRole('button', { name: 'row-maria' });
    fireEvent.click(link);
    await vi.waitFor(() =>
      expect(opened.location).toHaveBeenCalledWith({
        tableId: 'guests',
        rowId: 'row-maria',
      })
    );
    expect(opened.split).toHaveBeenCalledWith(
      { type: 'database', id: 'offsite' },
      { activate: true }
    );
    result.unmount();
  });
});
