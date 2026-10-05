import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from '@solidjs/testing-library';
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import { FormProvider } from '../context/form-context';
import type { FormColumn, FormDetail } from '../core/form-model';
import { FormConditionEditor } from '../form-condition-editor';
import { createMockFormContext } from '../tests/mock-context';
import { BuilderView } from './builder-view';

beforeAll(() => {
  Element.prototype.scrollIntoView = () => {};
});
beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const columns: FormColumn[] = [
  { id: 'name', name: 'Name', kind: { type: 'text' }, options: [] },
  {
    id: 'team',
    name: 'Team',
    kind: { type: 'select', multi: false },
    options: [
      { id: 'design', label: 'Design', color: null },
      { id: 'engineering', label: 'Engineering', color: null },
    ],
  },
  { id: 'notes', name: 'Notes', kind: { type: 'text' }, options: [] },
];

function rsvp(): FormDetail {
  return {
    form: {
      id: 'form-1',
      name: 'Team survey',
      description: '',
      ownerId: 'macro|owner@example.com',
      databaseId: 'database-1',
      tableId: 'table-1',
      audience: 'members',
      status: 'open',
      closesAt: null,
      tallyVisible: false,
      confirmationMessage: '',
      submittedColumnId: null,
      respondentColumnId: null,
    },
    layout: {
      sections: [
        {
          id: 'about',
          title: 'About you',
          description: '',
          kind: 'questions',
          gateRules: null,
          gateMessage: '',
          questions: [
            {
              id: 'q-name',
              columnId: 'name',
              helpText: '',
              required: true,
              widget: 'short',
            },
            {
              id: 'q-team',
              columnId: 'team',
              helpText: '',
              required: false,
              widget: 'choice',
            },
          ],
        },
      ],
    },
    columns: columns.slice(0, 2),
    access: 'owner',
    tableGone: false,
  };
}

function mount() {
  const mock = createMockFormContext({ detail: rsvp(), tableColumns: columns });
  render(() => (
    <FormProvider value={mock.context}>
      <BuilderView
        source={mock.source}
        detail={rsvp()}
        onOpenResponses={() => {}}
        onOpenDatabase={() => {}}
      />
    </FormProvider>
  ));
  return mock;
}

describe('BuilderView', () => {
  it('reorders a question with the keyboard and saves the layout once, 400ms after the drop', async () => {
    const { calls } = mount();
    const handle = screen.getByRole('button', { name: 'Move question “Name”' });
    handle.focus();
    fireEvent.keyDown(handle, { key: ' ' });
    fireEvent.keyDown(handle, { key: 'ArrowDown' });
    await vi.advanceTimersByTimeAsync(1000);
    expect(calls.layouts).toHaveLength(0);
    fireEvent.keyDown(handle, { key: ' ' });
    await vi.advanceTimersByTimeAsync(399);
    expect(calls.layouts).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(calls.layouts).toHaveLength(1);
    expect(
      calls.layouts[0].sections[0].questions.map((question) => question.id)
    ).toEqual(['q-team', 'q-name']);
    expect(document.activeElement).toBe(
      screen.getByRole('button', { name: 'Move question “Name”' })
    );
  });

  it('lists the column not on the form and adds it back as a question', async () => {
    const { calls } = mount();
    fireEvent.click(
      screen.getByRole('button', { name: /1 column not on this form/ })
    );
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    await vi.advanceTimersByTimeAsync(400);
    expect(
      calls.layouts
        .at(-1)
        ?.sections[0].questions.map((question) => question.columnId)
    ).toEqual(['name', 'team', 'notes']);
  });

  it('removes a selected question from the form, keeping its column', async () => {
    const { calls } = mount();
    fireEvent.click(screen.getByRole('group', { name: 'Question 2: Team' }));
    fireEvent.click(
      screen.getByRole('button', {
        name: 'Remove from form (keeps the column)',
      })
    );
    await vi.advanceTimersByTimeAsync(400);
    expect(
      calls.layouts
        .at(-1)
        ?.sections[0].questions.map((question) => question.columnId)
    ).toEqual(['name']);
    expect(
      screen.getByRole('button', { name: /2 columns not on this form/ })
    ).toBeTruthy();
  });

  it('builds a gate rule in the grid’s filter editor: the new condition stays while it is filled in, and saves once complete', async () => {
    const detail = rsvp();
    detail.layout.sections.push({
      id: 'gate',
      title: 'Eligibility',
      description: '',
      kind: 'gate',
      gateRules: { conjunction: 'and', conditions: [] },
      gateMessage: 'Not this time.',
      questions: [],
    });
    const mock = createMockFormContext({ detail, tableColumns: columns });
    const context = {
      ...mock.context,
      ui: {
        ...mock.context.ui,
        renderConditionEditor: FormConditionEditor,
      },
    };
    render(() => (
      <FormProvider value={context}>
        <BuilderView
          source={mock.source}
          detail={detail}
          onOpenResponses={() => {}}
          onOpenDatabase={() => {}}
        />
      </FormProvider>
    ));
    fireEvent.click(screen.getByRole('button', { name: 'Add rule' }));
    fireEvent.click(screen.getByRole('button', { name: /Add condition/ }));
    await vi.advanceTimersByTimeAsync(1000);
    // Incomplete, so nothing is saved, and the row is still there to fill in.
    expect(mock.calls.layouts).toHaveLength(0);
    const value = screen.getByRole('textbox', { name: 'Filter value' });
    fireEvent.input(value, { target: { value: 'Ada' } });
    await vi.advanceTimersByTimeAsync(400);
    expect(mock.calls.layouts.at(-1)?.sections[1].gateRules).toEqual({
      conjunction: 'and',
      conditions: [
        {
          kind: 'condition',
          column: 'name',
          test: { kind: 'text', operator: 'contains', value: 'Ada' },
        },
      ],
    });
    expect(screen.getByRole('textbox', { name: 'Filter value' })).toBe(value);
  });

  it('offers Add question inside an empty section, where a phone can reach it', () => {
    const detail = rsvp();
    detail.layout.sections.push({
      id: 'logistics',
      title: 'Logistics',
      description: '',
      kind: 'questions',
      gateRules: null,
      gateMessage: '',
      questions: [],
    });
    const mock = createMockFormContext({ detail, tableColumns: columns });
    render(() => (
      <FormProvider value={mock.context}>
        <BuilderView
          source={mock.source}
          detail={detail}
          onOpenResponses={() => {}}
          onOpenDatabase={() => {}}
        />
      </FormProvider>
    ));
    const logistics = screen.getByRole('region', { name: 'Logistics' });
    expect(
      within(logistics).getByRole('button', { name: /Add question/ })
    ).toBeTruthy();
  });
});
