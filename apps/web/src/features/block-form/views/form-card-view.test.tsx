import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FormContext } from '../context/form-context';
import { FormProvider } from '../context/form-context';
import type { FormDetail } from '../core/form-model';
import { createMockFormContext } from '../tests/mock-context';
import { FormCardView } from './form-card-view';

afterEach(cleanup);

function lunchPoll(access: FormDetail['access']): FormDetail {
  return {
    form: {
      id: 'poll-1',
      name: 'Where should we get lunch?',
      description: '',
      ownerId: 'macro|owner@example.com',
      databaseId: 'database-1',
      tableId: 'table-1',
      audience: 'members',
      status: 'open',
      closesAt: null,
      tallyVisible: true,
      confirmationMessage: '',
      submittedColumnId: null,
      respondentColumnId: null,
    },
    layout: {
      sections: [
        {
          id: 'section',
          title: '',
          description: '',
          kind: 'questions',
          gateRules: null,
          gateMessage: '',
          questions: [
            {
              id: 'question',
              columnId: 'answer',
              helpText: '',
              required: true,
              widget: 'choice',
            },
          ],
        },
      ],
    },
    columns: [
      {
        id: 'answer',
        name: 'Answer',
        kind: { type: 'select', multi: false },
        options: [
          { id: 'tacos', label: 'Tacos', color: null },
          { id: 'pho', label: 'Pho', color: null },
        ],
      },
    ],
    access,
    tableGone: false,
  };
}

const tally: FormContext['responses']['createTally'] = () => ({
  value: () => [
    {
      questionId: 'question',
      responses: 4,
      buckets: [
        { kind: 'option', optionId: 'tacos', count: 3 },
        { kind: 'option', optionId: 'pho', count: 1 },
      ],
    },
  ],
  failure: () => undefined,
});

function mount(
  access: FormDetail['access'],
  change: (detail: FormDetail) => void = () => {}
) {
  const detail = lunchPoll(access);
  change(detail);
  const base = createMockFormContext({ detail });
  const { context } = createMockFormContext({
    detail,
    overrides: { responses: { ...base.context.responses, createTally: tally } },
  });
  const onOpen = vi.fn();
  const onOpenResponses = vi.fn();
  render(() => (
    <FormProvider value={context}>
      <FormCardView
        refetch={async () => true}
        detail={detail}
        narrow={false}
        onOpen={onOpen}
        onOpenResponses={onOpenResponses}
      />
    </FormProvider>
  ));
  return { onOpen, onOpenResponses };
}

describe('FormCardView poll', () => {
  it('asks the poll question, not the column name, with a bar per option', () => {
    mount('view');
    expect(screen.getByText('Where should we get lunch?')).toBeTruthy();
    expect(screen.queryByText('Answer')).toBeNull();
    expect(screen.getByRole('radio', { name: /Tacos/ })).toBeTruthy();
    expect(screen.getByText('4 votes · one vote each')).toBeTruthy();
  });

  it('shows respondents the tally in place behind Results', () => {
    const { onOpen, onOpenResponses } = mount('view');
    const results = screen.getByRole('button', { name: 'Results' });
    expect(results.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(results);
    expect(screen.getByRole('region', { name: 'Poll results' })).toBeTruthy();
    expect(screen.getByText('3 votes · 75%')).toBeTruthy();
    expect(onOpen).not.toHaveBeenCalled();
    expect(onOpenResponses).not.toHaveBeenCalled();
  });

  it('sends editors to the Responses tab', () => {
    const { onOpen, onOpenResponses } = mount('edit');
    fireEvent.click(screen.getByRole('button', { name: 'Responses' }));
    expect(onOpenResponses).toHaveBeenCalledTimes(1);
    expect(onOpen).not.toHaveBeenCalled();
  });

  it('stops voting once the poll’s closing time has passed, and says it is closed', () => {
    mount('view', (detail) => {
      detail.form.closesAt = '2020-01-01T00:00:00Z';
    });
    expect(
      screen.getByRole('radio', { name: /Tacos/ }).hasAttribute('disabled')
    ).toBe(true);
    expect(screen.getByText('Closed')).toBeTruthy();
  });
});
