import { errAsync, okAsync } from 'neverthrow';
import { createRoot, createSignal } from 'solid-js';
import { describe, expect, it } from 'vitest';
import type { MyResponse, QuestionTally } from '../context/form-context';
import type { SubmittedAnswer } from '../core/answers';
import type { Poll } from '../core/tally';
import { createPollVoting } from './create-poll-voting';

const poll: Poll = {
  question: {
    id: 'question',
    columnId: 'answer',
    helpText: '',
    required: true,
    widget: 'choice',
  },
  column: {
    id: 'answer',
    name: 'Answer',
    kind: { type: 'select', multi: false },
    options: [
      { id: 'tacos', label: 'Tacos', color: null },
      { id: 'pho', label: 'Pho', color: null },
    ],
  },
  multi: false,
};

const tally: QuestionTally[] = [
  {
    questionId: 'question',
    responses: 3,
    buckets: [
      { kind: 'option', optionId: 'tacos', count: 2 },
      { kind: 'option', optionId: 'pho', count: 1 },
    ],
  },
];

describe('createPollVoting', () => {
  it('casts a first vote as a submission, then changes it by editing the response', async () => {
    const calls: [string, SubmittedAnswer[]][] = [];
    await createRoot(async (dispose) => {
      const [mine, setMine] = createSignal<MyResponse | null>(null);
      const voting = createPollVoting({
        poll: () => poll,
        mine,
        tally: () => tally,
        submit: (answers) => {
          calls.push(['POST', answers]);
          return okAsync({
            kind: 'submitted',
            responseId: 'response',
            booking: null,
          });
        },
        editMine: (answers) => {
          calls.push(['PUT', answers]);
          return okAsync({
            kind: 'submitted',
            responseId: 'response',
            booking: null,
          });
        },
        notify: () => {},
      });
      expect(voting.voted()).toBe(false);
      expect(voting.summary()).toBe('3 votes · one vote each');
      await voting.vote('tacos');
      expect(voting.myVote()).toEqual(['tacos']);
      setMine({
        status: 'submitted',
        booking: null,
        submittedAt: '2026-10-05T00:00:00Z',
        answers: [
          {
            question: 'question',
            value: { type: 'options', value: [{ id: 'tacos' }] },
          },
        ],
      });
      await voting.vote('pho');
      expect(calls).toEqual([
        [
          'POST',
          [
            {
              question: 'question',
              value: { type: 'options', value: [{ id: 'tacos' }] },
            },
          ],
        ],
        [
          'PUT',
          [
            {
              question: 'question',
              value: { type: 'options', value: [{ id: 'pho' }] },
            },
          ],
        ],
      ]);
      expect(
        voting.bars().map((bar) => [bar.label, bar.count, bar.mine])
      ).toEqual([
        ['Tacos', 2, false],
        ['Pho', 1, true],
      ]);
      dispose();
    });
  });

  it('takes the vote back and says why when it is refused', async () => {
    const notices: string[] = [];
    await createRoot(async (dispose) => {
      const voting = createPollVoting({
        poll: () => poll,
        mine: () => null,
        tally: () => undefined,
        submit: () =>
          errAsync({ message: 'This form is closed.', refusal: 'closed' }),
        editMine: () => errAsync({ message: 'unexpected' }),
        notify: (message) => notices.push(message),
      });
      await voting.vote('pho');
      expect(voting.myVote()).toEqual([]);
      expect(voting.hasTally()).toBe(false);
      expect(notices).toEqual([
        'Your vote wasn’t counted: This form is closed.',
      ]);
      dispose();
    });
  });
});
