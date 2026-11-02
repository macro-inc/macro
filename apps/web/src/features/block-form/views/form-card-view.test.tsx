import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FormContext, QuestionTally } from '../context/form-context';
import { FormProvider } from '../context/form-context';
import type { FormDetail } from '../core/form-model';
import { createMockFormContext, MOCK_VIEWER_ID } from '../tests/mock-context';
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
      responsesVisible: false,
      respondentHidden: false,
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
          bookingTarget: null,
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

/** Three for tacos and one for pho, naming the voters when `voters` holds them. */
function tallyOf(voters?: {
  tacos: string[];
  pho: string[];
}): FormContext['responses']['createTally'] {
  const buckets: QuestionTally['buckets'] = [
    { kind: 'option', optionId: 'tacos', count: 3, voters: voters?.tacos },
    { kind: 'option', optionId: 'pho', count: 1, voters: voters?.pho },
  ];
  return () => ({
    value: () => [{ questionId: 'question', responses: 4, buckets }],
    failure: () => undefined,
  });
}

const namedVoters = {
  tacos: ['macro|ada@example.com', MOCK_VIEWER_ID, 'macro|lin@example.com'],
  pho: ['macro|sam@example.com'],
};

function mount(
  access: FormDetail['access'],
  change: (detail: FormDetail) => void = () => {},
  tally = tallyOf()
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
    expect(
      screen.getByRole('radiogroup', { name: 'Where should we get lunch?' })
    ).toBeTruthy();
    expect(screen.queryByText('Where should we get lunch?')).toBeNull();
    expect(screen.queryByText('Answer')).toBeNull();
    expect(screen.getByRole('radio', { name: /Tacos/ })).toBeTruthy();
    expect(screen.getByText('4 votes · one vote each')).toBeTruthy();
  });

  it('offers respondents no Results when the bars already show everything they may see', () => {
    mount('view');
    expect(screen.queryByRole('button', { name: 'Results' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Responses' })).toBeNull();
  });

  it('shows who chose each option behind Results, marking the viewer', () => {
    const { onOpen, onOpenResponses } = mount(
      'view',
      (detail) => {
        detail.form.responsesVisible = true;
      },
      tallyOf(namedVoters)
    );
    const results = screen.getByRole('button', { name: 'Results' });
    expect(results.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(results);
    const region = screen.getByRole('region', { name: 'Poll results' });
    const tacos = within(region).getByText('3 votes').closest('div')
      ?.parentElement as HTMLElement;
    expect(within(tacos).getByText('macro|ada@example.com')).toBeTruthy();
    expect(within(tacos).getByText(MOCK_VIEWER_ID)).toBeTruthy();
    expect(within(tacos).getByText('(you)')).toBeTruthy();
    expect(within(region).getByText('macro|sam@example.com')).toBeTruthy();
    expect(within(region).getAllByText('(you)')).toHaveLength(1);
    fireEvent.click(
      within(region).getByRole('button', { name: 'Responses table' })
    );
    expect(onOpenResponses).toHaveBeenCalledTimes(1);
    expect(onOpen).not.toHaveBeenCalled();
  });

  it('expands Results in place when the voters arrive after the card first renders', () => {
    const [loaded, setLoaded] = createSignal(false);
    const named = tallyOf(namedVoters)(
      () => 'poll-1',
      () => true
    );
    const late: FormContext['responses']['createTally'] = () => ({
      value: () => (loaded() ? named.value() : undefined),
      failure: () => undefined,
    });
    const { onOpenResponses } = mount(
      'view',
      (detail) => {
        detail.form.responsesVisible = true;
      },
      late
    );
    expect(screen.getByRole('button', { name: 'Responses' })).toBeTruthy();
    setLoaded(true);
    fireEvent.click(screen.getByRole('button', { name: 'Results' }));
    expect(screen.getByRole('region', { name: 'Poll results' })).toBeTruthy();
    expect(onOpenResponses).not.toHaveBeenCalled();
  });

  it('sends anyone to the Responses tab when shared responses name nobody', () => {
    const { onOpen, onOpenResponses } = mount('view', (detail) => {
      detail.form.responsesVisible = true;
      detail.form.respondentHidden = true;
    });
    expect(screen.queryByRole('button', { name: 'Results' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Responses' }));
    expect(onOpenResponses).toHaveBeenCalledTimes(1);
    expect(onOpen).not.toHaveBeenCalled();
  });

  it('shows editors who voted for what behind Results', () => {
    mount('edit', () => {}, tallyOf(namedVoters));
    expect(screen.queryByText('can edit')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Results' }));
    expect(screen.getByText('macro|lin@example.com')).toBeTruthy();
  });

  it('sends editors of an anonymous poll to the Responses tab', () => {
    const { onOpenResponses } = mount('edit', (detail) => {
      detail.form.respondentHidden = true;
    });
    expect(screen.queryByRole('button', { name: 'Results' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Responses' }));
    expect(onOpenResponses).toHaveBeenCalledTimes(1);
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
