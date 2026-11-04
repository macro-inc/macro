import type { ResultAsync } from 'neverthrow';
import { type Accessor, createSignal } from 'solid-js';
import type {
  FormWriteFailure,
  MyResponse,
  QuestionTally,
  SubmitOutcome,
} from '../context/form-context';
import type { SubmittedAnswer } from '../core/answers';
import { type Poll, type PollBar, pollBars, pollSummary } from '../core/tally';

/**
 * Voting on a poll: a vote is a submission, changing it edits the viewer's
 * response. Results come from the tally, refreshed as votes land. A vote on
 * an anonymous poll is final, and which option it was isn't known after.
 */
export function createPollVoting(options: {
  poll: Accessor<Poll>;
  anonymous: Accessor<boolean>;
  mine: Accessor<MyResponse | null | undefined>;
  tally: Accessor<QuestionTally[] | undefined>;
  submit: (
    answers: SubmittedAnswer[]
  ) => ResultAsync<SubmitOutcome, FormWriteFailure>;
  editMine: (
    answers: SubmittedAnswer[]
  ) => ResultAsync<SubmitOutcome, FormWriteFailure>;
  notify: (message: string) => void;
}) {
  /** The vote as just cast, ahead of the stored response being read again. */
  const [cast, setCast] = createSignal<string[]>();
  const [pending, setPending] = createSignal(false);
  /** The server refused a vote on an anonymous poll this viewer voted in. */
  const [votedElsewhere, setVotedElsewhere] = createSignal(false);

  const stored = (): string[] => {
    const mine = options.mine();
    if (mine?.status !== 'submitted') return [];
    const answer = mine.answers.find(
      (item) => item.question === options.poll().question.id
    );
    if (answer?.value.type !== 'options') return [];
    return answer.value.value.flatMap((reference) =>
      'id' in reference ? [reference.id] : []
    );
  };
  const myVote = () => cast() ?? stored();
  const voted = () =>
    myVote().length > 0 || !!options.mine()?.anonymous || votedElsewhere();
  /** Voted on an anonymous poll, so the vote can't change. */
  const final = () => options.anonymous() && voted();
  const questionTally = () =>
    options
      .tally()
      ?.find((item) => item.questionId === options.poll().question.id);
  const counts = () => {
    const tally = questionTally();
    if (!tally) return undefined;
    return new Map(
      tally.buckets.flatMap((bucket) =>
        bucket.kind === 'option'
          ? [[bucket.optionId, bucket.count] as const]
          : []
      )
    );
  };
  /** Who chose each option, when the tally names voters to this viewer. */
  const voters = () => {
    const tally = questionTally();
    const named = tally?.buckets.flatMap((bucket) =>
      bucket.kind === 'option' && bucket.voters
        ? [[bucket.optionId, bucket.voters] as const]
        : []
    );
    return named && named.length > 0 ? new Map(named) : undefined;
  };
  const responses = () => questionTally()?.responses ?? 0;

  async function vote(optionId: string) {
    if (pending() || final()) return;
    const poll = options.poll();
    const current = myVote();
    const next = poll.multi
      ? current.includes(optionId)
        ? current.filter((id) => id !== optionId)
        : [...current, optionId]
      : current.includes(optionId)
        ? current
        : [optionId];
    if (next.length === 0 || next.join() === current.join()) return;
    const answers: SubmittedAnswer[] = [
      {
        question: poll.question.id,
        value: { type: 'options', value: next.map((id) => ({ id })) },
      },
    ];
    const editing = options.mine()?.status === 'submitted' || !!cast();
    setPending(true);
    setCast(next);
    let result = await (editing
      ? options.editMine(answers)
      : options.submit(answers));
    if (result.isErr() && result.error.refusal === 'already-responded') {
      if (options.anonymous()) {
        setPending(false);
        setCast(undefined);
        setVotedElsewhere(true);
        options.notify('You already voted in this anonymous poll.');
        return;
      }
      result = await options.editMine(answers);
    }
    setPending(false);
    if (result.isErr()) {
      setCast(undefined);
      options.notify(`Your vote wasn’t counted: ${result.error.message}`);
      return;
    }
    if (result.value.kind === 'stopped') {
      setCast(undefined);
      options.notify(result.value.message || 'This poll can’t take your vote.');
    }
  }

  return {
    myVote,
    voted,
    final,
    pending,
    vote,
    bars: (): PollBar[] =>
      pollBars(options.poll(), counts(), responses(), myVote(), voters()),
    summary: () => pollSummary(responses(), options.poll().multi),
    hasTally: () => !!questionTally(),
    /** Whether the tally says who voted for what. */
    hasVoters: () => !!voters(),
  };
}
