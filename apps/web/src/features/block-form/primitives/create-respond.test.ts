import { errAsync, okAsync } from 'neverthrow';
import { createRoot, createSignal } from 'solid-js';
import { describe, expect, it, vi } from 'vitest';
import type { MyResponse, SubmitOutcome } from '../context/form-context';
import type { SubmittedAnswer } from '../core/answers';
import type { FormDetail } from '../core/form-model';
import { createRespond } from './create-respond';

const TEAM = 'column-team';
const CONTRACTOR = 'option-contractor';
const EMPLOYEE = 'option-employee';

function offsite(): FormDetail {
  return {
    form: {
      id: 'form-1',
      name: 'Offsite RSVP',
      description: '',
      ownerId: 'macro|owner@example.com',
      databaseId: 'database-1',
      tableId: 'table-1',
      audience: 'members',
      status: 'open',
      closesAt: '2026-10-03T17:00:00Z',
      tallyVisible: false,
      confirmationMessage: 'See you there.',
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
          bookingTarget: null,
          questions: [
            {
              id: 'q-name',
              columnId: 'column-name',
              helpText: '',
              required: true,
              widget: 'short',
            },
            {
              id: 'q-team',
              columnId: TEAM,
              helpText: '',
              required: false,
              widget: 'choice',
            },
          ],
        },
        {
          id: 'eligibility',
          title: '',
          description: '',
          kind: 'gate',
          gateRules: {
            conjunction: 'and',
            conditions: [
              {
                kind: 'condition',
                column: TEAM,
                test: {
                  kind: 'options',
                  operator: 'isNoneOf',
                  options: [CONTRACTOR],
                },
              },
            ],
          },
          gateMessage: 'The offsite is for employees.',
          bookingTarget: null,
          questions: [],
        },
        {
          id: 'details',
          title: 'Details',
          description: '',
          kind: 'questions',
          gateRules: null,
          gateMessage: '',
          bookingTarget: null,
          questions: [
            {
              id: 'q-diet',
              columnId: 'column-diet',
              helpText: '',
              required: true,
              widget: 'paragraph',
            },
          ],
        },
      ],
    },
    columns: [
      { id: 'column-name', name: 'Name', kind: { type: 'text' }, options: [] },
      {
        id: TEAM,
        name: 'Team',
        kind: { type: 'select', multi: false },
        options: [
          { id: CONTRACTOR, label: 'Contractor', color: null },
          { id: EMPLOYEE, label: 'Employee', color: null },
        ],
      },
      { id: 'column-diet', name: 'Diet', kind: { type: 'text' }, options: [] },
    ],
    access: 'view',
    tableGone: false,
  };
}

const now = () => new Date('2026-10-01T12:00:00Z');

describe('createRespond', () => {
  it('previews a closed form, validates required answers and screeners, and never reads or writes a response', async () => {
    const detail: FormDetail = {
      form: {
        id: 'preview-form',
        name: 'RSVP',
        description: '',
        ownerId: 'macro|owner@example.com',
        databaseId: 'database',
        tableId: 'table',
        audience: 'members',
        status: 'closed',
        closesAt: null,
        tallyVisible: false,
        confirmationMessage: 'See you there.',
        submittedColumnId: null,
        respondentColumnId: null,
      },
      layout: {
        sections: [
          {
            id: 'questions',
            kind: 'questions',
            title: 'About you',
            description: '',
            gateRules: null,
            gateMessage: '',
            bookingTarget: null,
            questions: [
              {
                id: 'name',
                columnId: 'name-column',
                helpText: '',
                required: true,
                widget: 'short',
              },
            ],
          },
          {
            id: 'screener',
            kind: 'gate',
            title: 'Eligibility',
            description: '',
            questions: [],
            gateRules: {
              conjunction: 'and',
              conditions: [
                {
                  kind: 'condition',
                  column: 'name-column',
                  test: { kind: 'text', operator: 'is', value: 'Ada' },
                },
              ],
            },
            gateMessage: 'This invitation is for Ada.',
            bookingTarget: null,
          },
        ],
      },
      columns: [
        {
          id: 'name-column',
          name: 'Name',
          kind: { type: 'text' },
          options: [],
        },
      ],
      access: 'owner',
      tableGone: false,
    };
    const mine = vi.fn(() => undefined);
    const submit = vi.fn(() =>
      errAsync({ message: 'Preview must not submit' })
    );
    const editMine = vi.fn(() =>
      errAsync({ message: 'Preview must not edit' })
    );
    const reloadMine = vi.fn(async () => {});
    await createRoot(async (dispose) => {
      const respond = createRespond({
        detail: () => detail,
        preview: true,
        mine,
        mineFailed: () => false,
        reloadMine,
        refetch: async () => {},
        signedIn: () => true,
        submit,
        editMine,
        now,
      });
      expect(respond.view().kind).toBe('answering');
      await respond.submit();
      expect(respond.problems()).toEqual({
        name: 'This question is required.',
      });
      respond.setAnswer('name', { type: 'text', value: 'Grace' });
      await respond.submit();
      expect(respond.view()).toEqual({
        kind: 'stopped',
        message: 'This invitation is for Ada.',
      });
      respond.checkAnswers();
      respond.setAnswer('name', { type: 'text', value: 'Ada' });
      await respond.submit();
      expect(respond.view()).toEqual({
        kind: 'preview-complete',
        answers: { name: { type: 'text', value: 'Ada' } },
      });
      respond.restartPreview();
      expect(respond.view().kind).toBe('answering');
      expect(respond.answers()).toEqual({});
      expect(mine).not.toHaveBeenCalled();
      expect(submit).not.toHaveBeenCalled();
      expect(editMine).not.toHaveBeenCalled();
      expect(reloadMine).not.toHaveBeenCalled();
      dispose();
    });
  });

  it('walks a respondent through both sections and submits every answer once, showing the confirmation', async () => {
    const sent: SubmittedAnswer[][] = [];
    await createRoot(async (dispose) => {
      const respond = createRespond({
        detail: offsite,
        mine: () => null,
        signedIn: () => true,
        submit: (answers) => {
          sent.push(answers);
          return okAsync<SubmitOutcome, never>({
            kind: 'submitted',
            responseId: 'response-1',
            booking: null,
          });
        },
        editMine: () => errAsync({ message: 'unexpected' }),
        mineFailed: () => false,
        reloadMine: async () => {},
        refetch: async () => {},
        now,
      });
      expect(respond.view()).toMatchObject({
        kind: 'answering',
        position: 1,
        total: 2,
        isFirst: true,
        isLast: false,
      });
      expect(respond.next()).toBe(false);
      expect(respond.problems()).toEqual({
        'q-name': 'This question is required.',
      });
      respond.setAnswer('q-name', { type: 'text', value: 'Ada' });
      respond.setAnswer('q-team', {
        type: 'options',
        value: [{ id: EMPLOYEE }],
      });
      expect(respond.problems()).toEqual({});
      expect(respond.next()).toBe(true);
      expect(respond.view()).toMatchObject({
        kind: 'answering',
        position: 2,
        isLast: true,
      });
      respond.setAnswer('q-diet', { type: 'text', value: 'Vegetarian' });
      await respond.submit();
      expect(sent).toEqual([
        [
          { question: 'q-name', value: { type: 'text', value: 'Ada' } },
          {
            question: 'q-team',
            value: { type: 'options', value: [{ id: EMPLOYEE }] },
          },
          { question: 'q-diet', value: { type: 'text', value: 'Vegetarian' } },
        ],
      ]);
      expect(respond.view()).toMatchObject({
        kind: 'confirmation',
        fresh: true,
        canEdit: true,
      });
      dispose();
    });
  });

  it('lets a signed-in respondent of a public form edit their response, and an anonymous visitor not', async () => {
    const mine: MyResponse = {
      status: 'submitted',
      booking: null,
      submittedAt: '2026-09-30T10:00:00Z',
      answers: [{ question: 'q-name', value: { type: 'text', value: 'Ada' } }],
    };
    const publicForm = () => {
      const detail = offsite();
      detail.form.audience = 'public';
      return detail;
    };
    await createRoot(async (dispose) => {
      const [signedIn, setSignedIn] = createSignal(true);
      const respond = createRespond({
        detail: publicForm,
        mine: () => mine,
        signedIn,
        submit: () =>
          okAsync({ kind: 'submitted', responseId: 'r', booking: null }),
        editMine: () =>
          okAsync({ kind: 'submitted', responseId: 'r', booking: null }),
        mineFailed: () => false,
        reloadMine: async () => {},
        refetch: async () => {},
        now,
      });
      expect(respond.view()).toMatchObject({
        kind: 'confirmation',
        canEdit: true,
      });
      setSignedIn(false);
      expect(respond.view()).toMatchObject({ canEdit: false });
      dispose();
    });
  });

  it('stops at the gate on Next without sending anything, and goes back with answers kept', async () => {
    let calls = 0;
    await createRoot(async (dispose) => {
      const respond = createRespond({
        detail: offsite,
        mine: () => null,
        signedIn: () => true,
        submit: () => {
          calls += 1;
          return okAsync({ kind: 'submitted', responseId: 'r', booking: null });
        },
        editMine: () => errAsync({ message: 'unexpected' }),
        mineFailed: () => false,
        reloadMine: async () => {},
        refetch: async () => {},
        now,
      });
      respond.setAnswer('q-name', { type: 'text', value: 'Ada' });
      respond.setAnswer('q-team', {
        type: 'options',
        value: [{ id: CONTRACTOR }],
      });
      respond.next();
      expect(respond.view()).toEqual({
        kind: 'stopped',
        message: 'The offsite is for employees.',
      });
      respond.checkAnswers();
      expect(respond.view()).toMatchObject({ kind: 'answering', position: 1 });
      expect(respond.answers()['q-name']).toEqual({
        type: 'text',
        value: 'Ada',
      });
      expect(calls).toBe(0);
      dispose();
    });
  });

  it('shows the stop screen the server answers with', async () => {
    await createRoot(async (dispose) => {
      const detail = offsite();
      detail.layout.sections.splice(1, 2);
      const respond = createRespond({
        detail: () => detail,
        mine: () => null,
        signedIn: () => false,
        submit: () =>
          okAsync({
            kind: 'stopped',
            sectionId: 'eligibility',
            message: 'Not this time.',
          }),
        editMine: () => errAsync({ message: 'unexpected' }),
        mineFailed: () => false,
        reloadMine: async () => {},
        refetch: async () => {},
        now,
      });
      respond.setAnswer('q-name', { type: 'text', value: 'Ada' });
      await respond.submit();
      expect(respond.view()).toEqual({
        kind: 'stopped',
        message: 'Not this time.',
      });
      dispose();
    });
  });

  it('lands a returning respondent on their receipt and edits it with PUT, clearing emptied answers', async () => {
    const edits: SubmittedAnswer[][] = [];
    const mine: MyResponse = {
      status: 'submitted',
      booking: null,
      submittedAt: '2026-09-30T10:00:00Z',
      answers: [
        { question: 'q-name', value: { type: 'text', value: 'Ada' } },
        {
          question: 'q-team',
          value: { type: 'options', value: [{ id: EMPLOYEE }] },
        },
        { question: 'q-diet', value: { type: 'text', value: 'None' } },
      ],
    };
    await createRoot(async (dispose) => {
      const respond = createRespond({
        detail: offsite,
        mine: () => mine,
        signedIn: () => true,
        submit: () => errAsync({ message: 'unexpected' }),
        editMine: (answers) => {
          edits.push(answers);
          return okAsync({
            kind: 'submitted',
            responseId: 'response-1',
            booking: null,
          });
        },
        mineFailed: () => false,
        reloadMine: async () => {},
        refetch: async () => {},
        now,
      });
      expect(respond.view()).toMatchObject({
        kind: 'confirmation',
        fresh: false,
        canEdit: true,
        submittedAt: '2026-09-30T10:00:00Z',
      });
      respond.editResponse();
      expect(respond.view()).toMatchObject({ kind: 'answering', position: 1 });
      respond.setAnswer('q-name', { type: 'text', value: 'Ada Lovelace' });
      respond.next();
      respond.setAnswer('q-diet', { type: 'text', value: 'Vegan' });
      await respond.submit();
      expect(edits[0]).toEqual([
        { question: 'q-name', value: { type: 'text', value: 'Ada Lovelace' } },
        {
          question: 'q-team',
          value: { type: 'options', value: [{ id: EMPLOYEE }] },
        },
        { question: 'q-diet', value: { type: 'text', value: 'Vegan' } },
      ]);
      dispose();
    });
  });

  it('waits for a signed-in viewer’s response before choosing a screen', () => {
    createRoot((dispose) => {
      const [mine, setMine] = createSignal<MyResponse | null | undefined>();
      const respond = createRespond({
        detail: offsite,
        mine,
        signedIn: () => true,
        submit: () => errAsync({ message: 'unexpected' }),
        editMine: () => errAsync({ message: 'unexpected' }),
        mineFailed: () => false,
        reloadMine: async () => {},
        refetch: async () => {},
        now,
      });
      expect(respond.view()).toEqual({ kind: 'loading' });
      setMine(null);
      expect(respond.view().kind).toBe('answering');
      dispose();
    });
  });

  it('says a closed form is closed, and past its deadline too', () => {
    createRoot((dispose) => {
      const closed = offsite();
      closed.form.status = 'closed';
      const respond = createRespond({
        detail: () => closed,
        mine: () => null,
        signedIn: () => false,
        submit: () => errAsync({ message: 'unexpected' }),
        editMine: () => errAsync({ message: 'unexpected' }),
        mineFailed: () => false,
        reloadMine: async () => {},
        refetch: async () => {},
        now,
      });
      expect(respond.view()).toEqual({ kind: 'closed', reason: 'closed' });
      const late = createRespond({
        detail: offsite,
        mine: () => null,
        signedIn: () => false,
        submit: () => errAsync({ message: 'unexpected' }),
        editMine: () => errAsync({ message: 'unexpected' }),
        mineFailed: () => false,
        reloadMine: async () => {},
        refetch: async () => {},
        now: () => new Date('2026-10-04T00:00:00Z'),
      });
      expect(late.view()).toEqual({ kind: 'closed', reason: 'deadline' });
      dispose();
    });
  });

  it('jumps to the question the server refused and says why', async () => {
    await createRoot(async (dispose) => {
      const respond = createRespond({
        detail: offsite,
        mine: () => null,
        signedIn: () => true,
        submit: () =>
          errAsync({
            message: 'That option is no longer available.',
            refusal: 'invalid-answer',
            questionId: 'q-team',
          }),
        editMine: () => errAsync({ message: 'unexpected' }),
        mineFailed: () => false,
        reloadMine: async () => {},
        refetch: async () => {},
        now,
      });
      respond.setAnswer('q-name', { type: 'text', value: 'Ada' });
      respond.setAnswer('q-team', {
        type: 'options',
        value: [{ id: EMPLOYEE }],
      });
      respond.next();
      respond.setAnswer('q-diet', { type: 'text', value: 'Vegan' });
      await respond.submit();
      expect(respond.view()).toMatchObject({ kind: 'answering', position: 1 });
      expect(respond.problems()).toEqual({
        'q-team': 'That option is no longer available.',
      });
      expect(respond.failure()).toBe('That option is no longer available.');
      dispose();
    });
  });

  it('shows the closed view when the server says the form closed meanwhile, and reads the form again', async () => {
    let reads = 0;
    await createRoot(async (dispose) => {
      const respond = createRespond({
        detail: offsite,
        mine: () => null,
        signedIn: () => true,
        submit: () => errAsync({ message: 'Closed.', refusal: 'closed' }),
        editMine: () => errAsync({ message: 'unexpected' }),
        refetch: async () => {
          reads += 1;
        },
        mineFailed: () => false,
        reloadMine: async () => {},
        now,
      });
      respond.setAnswer('q-name', { type: 'text', value: 'Ada' });
      respond.setAnswer('q-team', {
        type: 'options',
        value: [{ id: EMPLOYEE }],
      });
      respond.next();
      respond.setAnswer('q-diet', { type: 'text', value: 'None' });
      await respond.submit();
      expect(respond.view()).toEqual({ kind: 'closed', reason: 'closed' });
      expect(reads).toBe(1);
      dispose();
    });
  });

  it('reads the form again after a refusal from a changed form, keeping answers and the section by id', async () => {
    const [detail, setDetail] = createSignal(offsite());
    await createRoot(async (dispose) => {
      const respond = createRespond({
        detail,
        mine: () => null,
        signedIn: () => true,
        submit: () =>
          errAsync({
            message: 'Answer the new question.',
            refusal: 'missing-answer',
            questionId: 'q-new',
          }),
        editMine: () => errAsync({ message: 'unexpected' }),
        refetch: async () => {
          // The editor added a required question to Details, and a section before it.
          const changed = offsite();
          changed.layout.sections.unshift({
            id: 'intro',
            title: 'Intro',
            description: '',
            kind: 'questions',
            gateRules: null,
            gateMessage: '',
            bookingTarget: null,
            questions: [],
          });
          changed.layout.sections[3].questions.push({
            id: 'q-new',
            columnId: 'column-name',
            helpText: '',
            required: true,
            widget: 'short',
          });
          setDetail(changed);
        },
        mineFailed: () => false,
        reloadMine: async () => {},
        now,
      });
      respond.setAnswer('q-name', { type: 'text', value: 'Ada' });
      respond.setAnswer('q-team', {
        type: 'options',
        value: [{ id: EMPLOYEE }],
      });
      respond.next();
      respond.setAnswer('q-diet', { type: 'text', value: 'None' });
      await respond.submit();
      expect(respond.view()).toMatchObject({
        kind: 'answering',
        section: { id: 'details' },
      });
      expect(respond.problems()).toEqual({
        'q-new': 'Answer the new question.',
      });
      expect(respond.answers()['q-diet']).toEqual({
        type: 'text',
        value: 'None',
      });
      dispose();
    });
  });

  it('lets a respondent answer when their earlier response couldn’t be read, instead of loading forever', () => {
    createRoot((dispose) => {
      const respond = createRespond({
        detail: offsite,
        mine: () => undefined,
        mineFailed: () => true,
        signedIn: () => true,
        submit: () => errAsync({ message: 'unexpected' }),
        editMine: () => errAsync({ message: 'unexpected' }),
        refetch: async () => {},
        reloadMine: async () => {},
        now,
      });
      expect(respond.view()).toMatchObject({ kind: 'answering', position: 1 });
      dispose();
    });
  });

  it('shows the saved response, not a silent overwrite, when one was already submitted elsewhere', async () => {
    const [mine, setMine] = createSignal<MyResponse | null>(null);
    const edits: SubmittedAnswer[][] = [];
    await createRoot(async (dispose) => {
      const respond = createRespond({
        detail: offsite,
        mine,
        signedIn: () => true,
        submit: () =>
          errAsync({ message: 'Already', refusal: 'already-responded' }),
        editMine: (answers) => {
          edits.push(answers);
          return okAsync({ kind: 'submitted', responseId: 'r', booking: null });
        },
        refetch: async () => {},
        reloadMine: async () => {
          setMine({
            status: 'submitted',
            booking: null,
            submittedAt: '2026-09-30T10:00:00Z',
            answers: [
              {
                question: 'q-name',
                value: { type: 'text', value: 'Ada (phone)' },
              },
            ],
          });
        },
        mineFailed: () => false,
        now,
      });
      respond.setAnswer('q-name', { type: 'text', value: 'Ada' });
      respond.setAnswer('q-team', {
        type: 'options',
        value: [{ id: EMPLOYEE }],
      });
      respond.next();
      respond.setAnswer('q-diet', { type: 'text', value: 'None' });
      await respond.submit();
      expect(edits).toEqual([]);
      expect(respond.view()).toMatchObject({
        kind: 'confirmation',
        fresh: false,
        alreadyResponded: true,
        answers: { 'q-name': { type: 'text', value: 'Ada (phone)' } },
      });
      dispose();
    });
  });

  it('holds Next and Submit while a file uploads, and drops an upload that lands after the answers were sent', async () => {
    await createRoot(async (dispose) => {
      const respond = createRespond({
        detail: offsite,
        mine: () => null,
        signedIn: () => true,
        submit: () =>
          okAsync({ kind: 'submitted', responseId: 'r', booking: null }),
        editMine: () => errAsync({ message: 'unexpected' }),
        refetch: async () => {},
        mineFailed: () => false,
        reloadMine: async () => {},
        now,
      });
      respond.setAnswer('q-name', { type: 'text', value: 'Ada' });
      respond.setAnswer('q-team', {
        type: 'options',
        value: [{ id: EMPLOYEE }],
      });
      const finished = respond.beginUpload();
      expect(respond.view()).toMatchObject({
        kind: 'answering',
        uploading: true,
      });
      expect(respond.next()).toBe(false);
      finished();
      expect(respond.next()).toBe(true);
      respond.setAnswer('q-diet', { type: 'text', value: 'None' });
      await respond.submit();
      respond.setAnswer('q-diet', { type: 'text', value: 'late' });
      expect(respond.view()).toMatchObject({
        kind: 'confirmation',
        answers: { 'q-diet': { type: 'text', value: 'None' } },
      });
      dispose();
    });
  });

  it('offers a receipt retry when the server reports an existing response but reading it fails', async () => {
    await createRoot(async (dispose) => {
      const [mine, setMine] = createSignal<MyResponse>();
      let reads = 0;
      const submit = vi.fn(() =>
        errAsync({
          message: 'Already responded',
          refusal: 'already-responded' as const,
        })
      );
      const respond = createRespond({
        detail: offsite,
        mine,
        signedIn: () => true,
        submit,
        editMine: () => errAsync({ message: 'unexpected edit' }),
        refetch: async () => {},
        mineFailed: () => true,
        reloadMine: async () => {
          reads += 1;
          if (reads === 2)
            setMine({
              status: 'submitted',
              submittedAt: '2026-09-30T10:00:00Z',
              booking: null,
              answers: [
                {
                  question: 'q-name',
                  value: { type: 'text', value: 'Ada (phone)' },
                },
              ],
            });
        },
        now,
      });
      respond.setAnswer('q-name', { type: 'text', value: 'Ada' });
      respond.setAnswer('q-team', {
        type: 'options',
        value: [{ id: EMPLOYEE }],
      });
      respond.next();
      respond.setAnswer('q-diet', { type: 'text', value: 'None' });
      await respond.submit();
      expect(respond.view()).toEqual({
        kind: 'response-unavailable',
        retrying: false,
      });
      await respond.retryResponse();
      expect(reads).toBe(2);
      expect(submit).toHaveBeenCalledTimes(1);
      expect(respond.view()).toMatchObject({
        kind: 'confirmation',
        alreadyResponded: true,
      });
      dispose();
    });
  });

  describe('a booking step', () => {
    const INTRO_CALL = { profileId: 'profile-1', eventTypeId: 'intro-call' };
    const UNLOCKED = {
      sectionId: 'call',
      title: 'Book a call',
      description: 'Thirty minutes with the team.',
      target: INTRO_CALL,
    };

    it('lets a booking-only form submit before revealing the server-approved destination', async () => {
      await createRoot(async (dispose) => {
        const detail = offsite();
        detail.layout.sections = [
          {
            id: 'call',
            title: 'Book a call',
            description: '',
            kind: 'booking',
            gateRules: null,
            gateMessage: '',
            bookingTarget: null,
            questions: [],
          },
        ];
        const submitted: SubmittedAnswer[][] = [];
        const respond = createRespond({
          detail: () => detail,
          mine: () => null,
          signedIn: () => false,
          submit: (answers) => {
            submitted.push(answers);
            return okAsync({
              kind: 'submitted',
              responseId: 'response-1',
              booking: UNLOCKED,
            });
          },
          editMine: () => errAsync({ message: 'unexpected edit' }),
          mineFailed: () => false,
          reloadMine: async () => {},
          refetch: async () => {},
          now,
        });
        expect(respond.view()).toMatchObject({
          kind: 'answering',
          isFirst: true,
          isLast: true,
          continuesToBooking: true,
        });
        expect(submitted).toEqual([]);
        await respond.submit();
        expect(submitted).toEqual([[]]);
        expect(respond.view()).toEqual({
          kind: 'booking',
          booking: UNLOCKED,
          preview: false,
        });
        dispose();
      });
    });

    it('previews an empty form without writing a response', async () => {
      await createRoot(async (dispose) => {
        const detail = offsite();
        detail.layout.sections = [];
        const submit = vi.fn(() => errAsync({ message: 'unexpected submit' }));
        const respond = createRespond({
          detail: () => detail,
          preview: true,
          mine: () => null,
          signedIn: () => true,
          submit,
          editMine: () => errAsync({ message: 'unexpected edit' }),
          mineFailed: () => false,
          reloadMine: async () => {},
          refetch: async () => {},
          now,
        });
        expect(respond.view()).toMatchObject({
          kind: 'answering',
          total: 0,
          isLast: true,
        });
        await respond.submit();
        expect(respond.view()).toEqual({
          kind: 'preview-complete',
          answers: {},
        });
        expect(submit).not.toHaveBeenCalled();
        dispose();
      });
    });

    /** The offsite form ending in a booking step, as a respondent reads it. */
    function booked(target: typeof INTRO_CALL | null = null): FormDetail {
      const detail = offsite();
      detail.layout.sections.push({
        id: 'call',
        title: 'Book a call',
        description: 'Thirty minutes with the team.',
        kind: 'booking',
        gateRules: null,
        gateMessage: '',
        bookingTarget: target,
        questions: [],
      });
      return detail;
    }

    function answerAll(respond: ReturnType<typeof createRespond>) {
      respond.setAnswer('q-name', { type: 'text', value: 'Ada' });
      respond.setAnswer('q-team', {
        type: 'options',
        value: [{ id: EMPLOYEE }],
      });
      respond.next();
      respond.setAnswer('q-diet', { type: 'text', value: 'None' });
    }

    it('opens the booking step only with the target the server returned for an accepted response', async () => {
      await createRoot(async (dispose) => {
        const sent: SubmittedAnswer[][] = [];
        const respond = createRespond({
          detail: () => booked(),
          mine: () => null,
          signedIn: () => false,
          submit: (answers) => {
            sent.push(answers);
            return okAsync({
              kind: 'submitted',
              responseId: 'response-1',
              booking: UNLOCKED,
            });
          },
          editMine: () => errAsync({ message: 'unexpected' }),
          mineFailed: () => false,
          reloadMine: async () => {},
          refetch: async () => {},
          now,
        });
        answerAll(respond);
        expect(respond.view()).toMatchObject({
          kind: 'answering',
          isLast: true,
          continuesToBooking: true,
        });
        await respond.submit();
        expect(sent).toHaveLength(1);
        expect(respond.view()).toEqual({
          kind: 'booking',
          booking: UNLOCKED,
          preview: false,
        });
        dispose();
      });
    });

    it('never opens it when the server stops the response, refuses it, or returns no target', async () => {
      const outcomes: SubmitOutcome[] = [
        {
          kind: 'stopped',
          sectionId: 'eligibility',
          message: 'Not this time.',
        },
        { kind: 'submitted', responseId: 'response-2', booking: null },
      ];
      for (const outcome of outcomes)
        await createRoot(async (dispose) => {
          const respond = createRespond({
            detail: () => booked(),
            mine: () => null,
            signedIn: () => false,
            submit: () => okAsync(outcome),
            editMine: () => errAsync({ message: 'unexpected' }),
            mineFailed: () => false,
            reloadMine: async () => {},
            refetch: async () => {},
            now,
          });
          answerAll(respond);
          await respond.submit();
          expect(respond.view().kind).not.toBe('booking');
          dispose();
        });
      await createRoot(async (dispose) => {
        const respond = createRespond({
          detail: () => booked(),
          mine: () => null,
          signedIn: () => false,
          submit: () =>
            errAsync({ message: 'Something failed.', refusal: 'internal' }),
          editMine: () => errAsync({ message: 'unexpected' }),
          mineFailed: () => false,
          reloadMine: async () => {},
          refetch: async () => {},
          now,
        });
        answerAll(respond);
        await respond.submit();
        expect(respond.view()).toMatchObject({ kind: 'answering' });
        expect(respond.failure()).toBe('Something failed.');
        dispose();
      });
    });

    it('keeps the booking step while the respondent’s response is read again', async () => {
      await createRoot(async (dispose) => {
        const [mine, setMine] = createSignal<MyResponse | null | undefined>(
          null
        );
        const respond = createRespond({
          detail: () => booked(),
          mine,
          signedIn: () => true,
          submit: () =>
            okAsync({
              kind: 'submitted',
              responseId: 'response-1',
              booking: UNLOCKED,
            }),
          editMine: () => errAsync({ message: 'unexpected' }),
          mineFailed: () => false,
          reloadMine: async () => {},
          refetch: async () => {},
          now,
        });
        answerAll(respond);
        await respond.submit();
        setMine(undefined);
        expect(respond.view()).toEqual({
          kind: 'booking',
          booking: UNLOCKED,
          preview: false,
        });
        setMine({
          status: 'submitted',
          submittedAt: '2026-10-01T12:00:00Z',
          answers: [],
          booking: null,
        });
        expect(respond.view()).toMatchObject({ kind: 'booking' });
        dispose();
      });
    });

    it('offers a returning respondent the booking step their saved response still unlocks', () => {
      createRoot((dispose) => {
        const mine: MyResponse = {
          status: 'submitted',
          submittedAt: '2026-09-30T10:00:00Z',
          answers: [
            { question: 'q-name', value: { type: 'text', value: 'Ada' } },
          ],
          booking: UNLOCKED,
        };
        const respond = createRespond({
          detail: () => booked(),
          mine: () => mine,
          signedIn: () => true,
          submit: () => errAsync({ message: 'unexpected' }),
          editMine: () => errAsync({ message: 'unexpected' }),
          mineFailed: () => false,
          reloadMine: async () => {},
          refetch: async () => {},
          now,
        });
        expect(respond.view()).toMatchObject({
          kind: 'confirmation',
          booking: UNLOCKED,
        });
        respond.openBooking();
        expect(respond.view()).toEqual({
          kind: 'booking',
          booking: UNLOCKED,
          preview: false,
        });
        dispose();
      });
      createRoot((dispose) => {
        const respond = createRespond({
          detail: () => booked(),
          mine: () => ({
            status: 'submitted',
            submittedAt: '2026-09-30T10:00:00Z',
            answers: [],
            booking: null,
          }),
          signedIn: () => true,
          submit: () => errAsync({ message: 'unexpected' }),
          editMine: () => errAsync({ message: 'unexpected' }),
          mineFailed: () => false,
          reloadMine: async () => {},
          refetch: async () => {},
          now,
        });
        expect(respond.view()).toMatchObject({
          kind: 'confirmation',
          booking: null,
        });
        respond.openBooking();
        expect(respond.view().kind).toBe('confirmation');
        dispose();
      });
    });

    it('previews the editor’s booking step after the answers pass locally, sending nothing', async () => {
      await createRoot(async (dispose) => {
        const submit = vi.fn(() => errAsync({ message: 'unexpected' }));
        const respond = createRespond({
          detail: () => booked(INTRO_CALL),
          preview: true,
          mine: () => undefined,
          signedIn: () => true,
          submit,
          editMine: submit,
          mineFailed: () => false,
          reloadMine: async () => {},
          refetch: async () => {},
          now,
        });
        respond.setAnswer('q-name', { type: 'text', value: 'Ada' });
        respond.setAnswer('q-team', {
          type: 'options',
          value: [{ id: CONTRACTOR }],
        });
        respond.next();
        expect(respond.view()).toMatchObject({ kind: 'stopped' });
        respond.checkAnswers();
        respond.setAnswer('q-team', {
          type: 'options',
          value: [{ id: EMPLOYEE }],
        });
        respond.next();
        respond.setAnswer('q-diet', { type: 'text', value: 'None' });
        await respond.submit();
        expect(submit).not.toHaveBeenCalled();
        expect(respond.view()).toEqual({
          kind: 'booking',
          booking: UNLOCKED,
          preview: true,
        });
        respond.restartPreview();
        expect(respond.view()).toMatchObject({
          kind: 'answering',
          position: 1,
        });
        dispose();
      });
    });
  });
});
