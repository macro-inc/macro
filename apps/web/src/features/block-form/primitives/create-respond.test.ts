import { errAsync, okAsync } from 'neverthrow';
import { createRoot, createSignal } from 'solid-js';
import { describe, expect, it } from 'vitest';
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
          questions: [],
        },
        {
          id: 'details',
          title: 'Details',
          description: '',
          kind: 'questions',
          gateRules: null,
          gateMessage: '',
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
        submit: () => okAsync({ kind: 'submitted', responseId: 'r' }),
        editMine: () => okAsync({ kind: 'submitted', responseId: 'r' }),
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
          return okAsync({ kind: 'submitted', responseId: 'r' });
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
          return okAsync({ kind: 'submitted', responseId: 'response-1' });
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
          return okAsync({ kind: 'submitted', responseId: 'r' });
        },
        refetch: async () => {},
        reloadMine: async () => {
          setMine({
            status: 'submitted',
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
        submit: () => okAsync({ kind: 'submitted', responseId: 'r' }),
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
});
