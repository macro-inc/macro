import type { ResultAsync } from 'neverthrow';
import { type Accessor, batch, createMemo, createSignal } from 'solid-js';
import type {
  FormRefusal,
  FormWriteFailure,
  MyResponse,
  SubmitOutcome,
} from '../context/form-context';
import {
  type AnswerProblem,
  answersOf,
  endsWithBooking,
  type FormStep,
  nextStep,
  previousSectionIndex,
  questionSectionIndices,
  type SubmittedAnswer,
  sectionProblems,
  submissionAnswers,
} from '../core/answers';
import type {
  FormAnswers,
  FormCellValue,
  FormColumn,
  FormDetail,
  FormSection,
  UnlockedBooking,
} from '../core/form-model';
import { formAvailability } from '../core/form-status';

/** What the respondent sees. */
export type RespondView =
  | { kind: 'loading' }
  | { kind: 'preview-complete'; answers: FormAnswers }
  | { kind: 'closed'; reason: 'closed' | 'deadline' | 'table-gone' }
  /** The form is being changed under the respondent: try again shortly. */
  | { kind: 'updating' }
  | {
      kind: 'answering';
      section: FormSection;
      /** 1-based among questions sections. */
      position: number;
      total: number;
      isFirst: boolean;
      isLast: boolean;
      submitting: boolean;
      /** A file is still uploading: Next and Submit wait. */
      uploading: boolean;
      /** Submitting leads on to a booking step. */
      continuesToBooking: boolean;
    }
  | { kind: 'stopped'; message: string }
  /**
   * The booking step, opened with the target the server returned for an
   * accepted response, or in preview with the editor's own.
   */
  | { kind: 'booking'; booking: UnlockedBooking; preview: boolean }
  | {
      kind: 'confirmation';
      answers: FormAnswers;
      /** Submitted just now, rather than found on arrival. */
      fresh: boolean;
      /** A response was already saved elsewhere; these answers weren't sent. */
      alreadyResponded: boolean;
      /** Signed in (either audience) and the form still open. */
      canEdit: boolean;
      submittedAt: string | undefined;
      /** The booking step this response unlocked, offered again. */
      booking: UnlockedBooking | null;
    };

export type RespondOptions = {
  detail: Accessor<FormDetail>;
  /** Exercise the respondent flow locally, including closed drafts. */
  preview?: boolean;
  /** The viewer's own response: undefined while loading, null when none. */
  mine: Accessor<MyResponse | null | undefined>;
  /** Reading it failed: the respondent answers, and the server decides. */
  mineFailed: Accessor<boolean>;
  /** Read the viewer's own response again. */
  reloadMine: () => Promise<void>;
  /** Read the form again, after a refusal that says it changed. */
  refetch: () => Promise<void>;
  signedIn: Accessor<boolean>;
  submit: (
    answers: SubmittedAnswer[]
  ) => ResultAsync<SubmitOutcome, FormWriteFailure>;
  editMine: (
    answers: SubmittedAnswer[]
  ) => ResultAsync<SubmitOutcome, FormWriteFailure>;
  now: () => Date;
};

type Phase =
  | { kind: 'answering'; sectionId: string }
  | { kind: 'stopped'; message: string }
  | { kind: 'closed'; reason: 'closed' | 'table-gone' }
  | { kind: 'updating' }
  | { kind: 'preview-complete'; answers: FormAnswers }
  /** Answers were refused because a response exists: show that one. */
  | { kind: 'already-responded' }
  | {
      kind: 'confirmation';
      answers: FormAnswers;
      submittedAt: string;
      booking: UnlockedBooking | null;
    }
  | { kind: 'booking'; booking: UnlockedBooking; preview: boolean };

/** Refusals that mean the form changed since it was read. */
const CHANGED_FORM: readonly FormRefusal[] = [
  'unknown-question',
  'missing-answer',
  'invalid-answer',
  'widget-mismatch',
  'invalid-layout',
];

/**
 * One respondent's pass through a form: a section per screen, answers kept in
 * memory, gates checked locally on Next and by the server on Submit. Nothing
 * is sent until Submit.
 */
export function createRespond(options: RespondOptions) {
  const [phase, setPhase] = createSignal<Phase>();
  const [answers, setAnswers] = createSignal<FormAnswers>({});
  const [problems, setProblems] = createSignal<Record<string, string>>({});
  const [submitting, setSubmitting] = createSignal(false);
  const [failure, setFailure] = createSignal<string>();
  /** Editing a stored response sends `PUT mine`; a first response `POST`s. */
  const [editing, setEditing] = createSignal(false);
  const [uploads, setUploads] = createSignal(0);

  const layout = () => options.detail().layout;
  const columns = createMemo(
    () =>
      new Map<string, FormColumn>(
        options.detail().columns.map((column) => [column.id, column])
      )
  );
  const availability = () =>
    formAvailability(
      options.detail().form,
      options.detail().tableGone,
      options.now()
    );
  // Signed in, on either audience, a respondent keeps their identity and can
  // edit while the form is open; anonymous visitors cannot.
  const canEdit = () => options.signedIn() && availability().kind === 'open';

  const firstSectionIndex = () => {
    const step = nextStep(layout(), -1, answers());
    return step.kind === 'section' ? step.index : undefined;
  };

  /** The section shown, by id; one the form lost falls back to the first. */
  const currentIndex = () => {
    const current = phase();
    if (current?.kind !== 'answering') return firstSectionIndex();
    const index = layout().sections.findIndex(
      (section) => section.id === current.sectionId
    );
    return index >= 0 ? index : firstSectionIndex();
  };

  const showSection = (index: number) => {
    const section = layout().sections[index];
    if (section) setPhase({ kind: 'answering', sectionId: section.id });
  };

  const stored = () => {
    if (options.preview) return undefined;
    const mine = options.mine();
    return mine?.status === 'submitted' ? mine : undefined;
  };

  const view = createMemo((): RespondView => {
    const current = phase();
    // What this visit just did comes first: reading the response again
    // never unmounts a booking in progress or the fresh receipt.
    if (current?.kind === 'booking' || current?.kind === 'preview-complete')
      return current;
    if (current?.kind === 'confirmation')
      return {
        kind: 'confirmation',
        answers: current.answers,
        fresh: true,
        alreadyResponded: false,
        canEdit: canEdit(),
        submittedAt: current.submittedAt,
        booking: current.booking,
      };
    if (
      !options.preview &&
      options.signedIn() &&
      options.mine() === undefined &&
      !options.mineFailed()
    )
      return { kind: 'loading' };
    const open = availability();
    const previous = stored();
    if ((!current || current.kind === 'already-responded') && previous)
      return {
        kind: 'confirmation',
        answers: answersOf(previous.answers),
        fresh: false,
        alreadyResponded: current?.kind === 'already-responded',
        canEdit: canEdit(),
        submittedAt: previous.submittedAt,
        booking: previous.booking,
      };
    if (current?.kind === 'closed')
      return { kind: 'closed', reason: current.reason };
    if (open.kind === 'table-gone')
      return { kind: 'closed', reason: 'table-gone' };
    if (open.kind === 'closed' && !options.preview)
      return { kind: 'closed', reason: open.reason };
    if (current?.kind === 'updating') return { kind: 'updating' };
    if (current?.kind === 'stopped')
      return { kind: 'stopped', message: current.message };
    const sectionIndex = currentIndex();
    const indices = questionSectionIndices(layout());
    const section =
      sectionIndex === undefined ? undefined : layout().sections[sectionIndex];
    if (!section || sectionIndex === undefined)
      return { kind: 'closed', reason: 'closed' };
    const position = indices.indexOf(sectionIndex) + 1;
    return {
      kind: 'answering',
      section,
      position,
      total: indices.length,
      isFirst: previousSectionIndex(layout(), sectionIndex) === undefined,
      // Structural: a gate that would stop someone still shows "Next".
      isLast: position === indices.length,
      submitting: submitting(),
      uploading: uploads() > 0,
      continuesToBooking: endsWithBooking(layout()),
    };
  });

  /** Where a step leads: a section, the stop screen, or the update notice. */
  function follow(step: FormStep) {
    if (step.kind === 'section') showSection(step.index);
    else if (step.kind === 'stop')
      setPhase({ kind: 'stopped', message: step.message });
    else if (step.kind === 'updating') setPhase({ kind: 'updating' });
  }

  /** Problems of the shown section; true when there are none. */
  function validateSection(sectionIndex: number): boolean {
    const section = layout().sections[sectionIndex];
    if (!section) return true;
    const found: AnswerProblem[] = sectionProblems(
      section,
      columns(),
      answers(),
      options.preview ? 'preview' : 'response'
    );
    setProblems(
      Object.fromEntries(
        found.map((problem) => [problem.questionId, problem.message])
      )
    );
    return found.length === 0;
  }

  function setAnswer(questionId: string, value: FormCellValue | undefined) {
    // Answers change only while answering: a late upload lands nowhere.
    if (view().kind !== 'answering') return;
    batch(() => {
      setAnswers((current) => {
        const next = { ...current };
        if (value === undefined) delete next[questionId];
        else next[questionId] = value;
        return next;
      });
      setFailure(undefined);
      if (problems()[questionId])
        setProblems((current) => {
          const next = { ...current };
          delete next[questionId];
          return next;
        });
    });
  }

  function next() {
    const index = currentIndex();
    if (uploads() > 0 || index === undefined || !validateSection(index))
      return false;
    const step = nextStep(layout(), index, answers());
    follow(step);
    return step.kind === 'section';
  }

  function back() {
    const index = currentIndex();
    if (index === undefined) return;
    const previous = previousSectionIndex(layout(), index);
    if (previous === undefined) return;
    setProblems({});
    showSection(previous);
  }

  /** The section holding a question, as a layout index. */
  function sectionOf(questionId: string) {
    return layout().sections.findIndex((section) =>
      section.questions.some((question) => question.id === questionId)
    );
  }

  async function send(mode: 'create' | 'edit'): Promise<void> {
    const sent = submissionAnswers(layout(), answers(), mode);
    const result = await (mode === 'edit'
      ? options.editMine(sent)
      : options.submit(sent));
    if (result.isOk()) {
      const outcome = result.value;
      if (outcome.kind === 'stopped') {
        setPhase({ kind: 'stopped', message: outcome.message });
        return;
      }
      batch(() => {
        setPhase(
          outcome.booking
            ? { kind: 'booking', booking: outcome.booking, preview: false }
            : {
                kind: 'confirmation',
                answers: { ...answers() },
                submittedAt: options.now().toISOString(),
                booking: null,
              }
        );
        setEditing(false);
      });
      return;
    }
    const refused = result.error;
    const refusal = refused.refusal;
    if (refusal === 'already-responded' && mode === 'create') {
      // Never overwrite a response saved elsewhere unseen: show it instead.
      await options.reloadMine();
      setPhase({ kind: 'already-responded' });
      return;
    }
    if (refusal === 'closed' || refusal === 'table-gone') {
      setPhase({
        kind: 'closed',
        reason: refusal === 'closed' ? 'closed' : 'table-gone',
      });
      await options.refetch();
      return;
    }
    if (refusal && CHANGED_FORM.includes(refusal)) await options.refetch();
    if (refusal === 'invalid-layout') {
      setPhase({ kind: 'updating' });
      return;
    }
    if (refused.questionId) {
      const index = sectionOf(refused.questionId);
      if (index >= 0) showSection(index);
      setProblems({ [refused.questionId]: refused.message });
    }
    setFailure(refused.message);
  }

  /** In preview, the editor's own booking step stands in for the server's. */
  function previewBooking(): UnlockedBooking | undefined {
    const section = layout().sections.find((item) => item.kind === 'booking');
    if (!section?.bookingTarget) return undefined;
    return {
      sectionId: section.id,
      title: section.title,
      description: section.description,
      target: section.bookingTarget,
    };
  }

  async function submit() {
    const index = currentIndex();
    if (
      index === undefined ||
      submitting() ||
      uploads() > 0 ||
      !validateSection(index)
    )
      return;
    const step = nextStep(layout(), index, answers());
    if (step.kind !== 'submit') {
      follow(step);
      return;
    }
    if (options.preview) {
      const booking = previewBooking();
      setPhase(
        booking
          ? { kind: 'booking', booking, preview: true }
          : { kind: 'preview-complete', answers: { ...answers() } }
      );
      return;
    }
    setSubmitting(true);
    setFailure(undefined);
    try {
      await send(editing() ? 'edit' : 'create');
    } finally {
      setSubmitting(false);
    }
  }

  return {
    view,
    answers,
    problems,
    failure,
    editing,
    columns,
    setAnswer,
    next,
    back,
    submit,
    restartPreview() {
      if (!options.preview) return;
      batch(() => {
        setAnswers({});
        setProblems({});
        setFailure(undefined);
        setPhase(undefined);
      });
    },
    /** A file started uploading; call the answer when it is done. */
    beginUpload() {
      setUploads((count) => count + 1);
      let done = false;
      return () => {
        if (done) return;
        done = true;
        setUploads((count) => count - 1);
      };
    },
    /** From the stop screen, back to the first section with every answer kept. */
    checkAnswers() {
      const first = firstSectionIndex();
      setProblems({});
      if (first !== undefined) showSection(first);
    },
    /** From the receipt, open the booking step the response unlocked. */
    openBooking() {
      const current = view();
      if (current.kind !== 'confirmation' || !current.booking) return;
      setPhase({ kind: 'booking', booking: current.booking, preview: false });
    },
    /** From the receipt, edit the stored response in place. */
    editResponse() {
      const current = view();
      if (current.kind !== 'confirmation' || !current.canEdit) return;
      batch(() => {
        setAnswers({ ...current.answers });
        setEditing(true);
        setProblems({});
        const first = nextStep(layout(), -1, current.answers);
        if (first.kind === 'section') showSection(first.index);
      });
    },
  };
}

export type Respond = ReturnType<typeof createRespond>;
