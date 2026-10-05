import { afterEach, describe, expect, test } from 'bun:test';
import { DatabaseTable } from '../src/entities/databases/table';
import { Macro } from '../src/macro';

const originalFetch = globalThis.fetch;
const host = 'https://storage.example.test';
const formId = '0198a4cc-e138-7670-a308-a6b766603700';
const databaseId = '0198a4cc-e138-7670-a308-a6b766603701';
const tableId = '0198a4cc-e138-7670-a308-a6b766603702';
const sectionId = '0198a4cc-e138-7670-a308-a6b766603703';
const questionId = '0198a4cc-e138-7670-a308-a6b766603704';
const columnId = '0198a4cc-e138-7670-a308-a6b766603705';
const responseId = '0198a4cc-e138-7670-a308-a6b766603706';
const rowId = '0198a4cc-e138-7670-a308-a6b766603707';

const registration = {
  form: {
    id: formId,
    name: 'Workshop registration',
    description: 'Tell us who is coming.',
    ownerId: 'macro|owner@example.test',
    databaseId,
    tableId,
    submittedColumnId: null,
    respondentColumnId: null,
    audience: 'members',
    tallyVisible: false,
    status: 'open',
    closesAt: null,
    confirmationMessage: 'See you there!',
    createdAt: '2026-10-05T00:00:00Z',
    updatedAt: '2026-10-05T00:00:00Z',
  },
  access: 'owner',
  tableGone: false,
  sections: [
    {
      kind: 'questions',
      id: sectionId,
      title: 'About you',
      description: '',
      questions: [
        {
          id: questionId,
          column: columnId,
          title: 'Name',
          kind: { type: 'text' },
          options: [],
          helpText: 'The name for your badge.',
          required: true,
          widget: 'short',
        },
      ],
    },
  ],
};

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('Forms', () => {
  test('creates over a table handle and exposes questions without reading the database', async () => {
    const requests: { method: string; path: string; body: unknown }[] = [];
    globalThis.fetch = (async (input) => {
      const request = input instanceof Request ? input : new Request(input);
      requests.push({
        method: request.method,
        path: new URL(request.url).pathname,
        body: await request.json(),
      });
      return Response.json(registration, { status: 201 });
    }) as typeof fetch;

    const macro = new Macro({ token: 'user-token', hosts: { storage: host } });
    const table = DatabaseTable.byId(macro.databases.byId(databaseId), tableId);
    const form = await macro.forms.create({
      name: 'Workshop registration',
      table,
    });
    expect(form.id).toBe(formId);
    expect(await form.name()).toBe('Workshop registration');
    expect((await form.database()).id).toBe(databaseId);
    expect((await form.table()).id).toBe(tableId);
    const [question] = await form.questions();
    expect(question?.id).toBe(questionId);
    expect(await question?.title()).toBe('Name');
    expect((await question?.column())?.id).toBe(columnId);
    expect(requests).toEqual([
      {
        method: 'POST',
        path: '/forms',
        body: {
          name: 'Workshop registration',
          source: { kind: 'table', databaseId, tableId },
        },
      },
    ]);
  });

  test('submits question handles and maps the receipt to response and row handles', async () => {
    const requests: { method: string; path: string; body: unknown }[] = [];
    globalThis.fetch = (async (input) => {
      const request = input instanceof Request ? input : new Request(input);
      if (request.method === 'GET') return Response.json(registration);
      requests.push({
        method: request.method,
        path: new URL(request.url).pathname,
        body: await request.json(),
      });
      return Response.json({
        outcome: 'submitted',
        response: responseId,
        row: rowId,
      });
    }) as typeof fetch;

    const macro = new Macro({ token: 'user-token', hosts: { storage: host } });
    const form = macro.forms.byId(formId);
    const [question] = await form.questions();
    if (!question) throw new Error('Missing fixture question');
    const result = await form.submit([
      { question, value: { type: 'text', value: 'Ada' } },
    ]);
    expect(result.outcome).toBe('submitted');
    if (result.outcome !== 'submitted')
      throw new Error('Expected a submitted response');
    expect(result.response.id).toBe(responseId);
    expect(result.response.form).toBe(form);
    expect(result.row.id).toBe(rowId);
    expect(result.row.table.id).toBe(tableId);
    expect(await result.response.status()).toBe('submitted');
    expect((await result.response.row())?.id).toBe(rowId);
    expect((await result.response.answers())[0]?.value).toEqual({
      type: 'text',
      value: 'Ada',
    });
    expect(requests).toEqual([
      {
        method: 'POST',
        path: `/forms/${formId}/responses`,
        body: {
          answers: [
            { question: questionId, value: { type: 'text', value: 'Ada' } },
          ],
        },
      },
    ]);
  });

  test.each([
    401, 503,
  ])('keeps the submitted receipt when refresh fails with %i', async (status) => {
    globalThis.fetch = (async (input) => {
      const request = input instanceof Request ? input : new Request(input);
      if (new URL(request.url).pathname.endsWith('/responses/mine'))
        return Response.json(
          {
            code: status === 401 ? 'signInRequired' : 'internal',
            message: 'Cannot refresh this receipt.',
            question: null,
            problem: null,
          },
          { status },
        );
      if (request.method === 'POST')
        return Response.json({
          outcome: 'submitted',
          response: responseId,
          row: rowId,
        });
      return Response.json(registration);
    }) as typeof fetch;
    const macro = new Macro({ token: 'user-token', hosts: { storage: host } });
    const outcome = await macro.forms.byId(formId).submit([]);
    if (outcome.outcome !== 'submitted')
      throw new Error('Expected a submitted response');
    await expect(outcome.response.refresh()).rejects.toThrow();
    expect(await outcome.response.status()).toBe('submitted');
    expect((await outcome.response.row())?.id).toBe(rowId);
    expect(await outcome.response.answers()).toEqual([]);
  });

  test('refuses a question from another form before sending a response', async () => {
    let writes = 0;
    globalThis.fetch = (async (input) => {
      const request = input instanceof Request ? input : new Request(input);
      if (request.method !== 'GET') writes++;
      return Response.json(registration);
    }) as typeof fetch;
    const macro = new Macro({ token: 'user-token', hosts: { storage: host } });
    const [question] = await macro.forms.byId(formId).questions();
    if (!question) throw new Error('Missing fixture question');
    await expect(
      macro.forms
        .byId('0198a4cc-e138-7670-a308-a6b766603708')
        .submit([{ question, value: { type: 'text', value: 'Ada' } }]),
    ).rejects.toThrow('does not belong');
    expect(writes).toBe(0);
  });

  test('invalidates detail after metadata updates and keeps close-time null explicit', async () => {
    let reads = 0;
    let update: unknown;
    globalThis.fetch = (async (input) => {
      const request = input instanceof Request ? input : new Request(input);
      if (request.method === 'PATCH') {
        update = await request.json();
        return Response.json({ ...registration.form, description: 'Updated' });
      }
      reads++;
      return Response.json({
        ...registration,
        form: {
          ...registration.form,
          description: reads > 1 ? 'Updated' : registration.form.description,
        },
      });
    }) as typeof fetch;
    const macro = new Macro({ token: 'user-token', hosts: { storage: host } });
    const form = macro.forms.byId(formId);
    expect(await form.description()).toBe('Tell us who is coming.');
    await form.update({ description: 'Updated', closesAt: null });
    expect(await form.description()).toBe('Updated');
    expect(update).toEqual({ description: 'Updated', closesAt: null });
    expect(reads).toBe(2);
  });

  test('replaces layout with stable handles and rejects sections of another form', async () => {
    let layout: unknown;
    let writes = 0;
    globalThis.fetch = (async (input) => {
      const request = input instanceof Request ? input : new Request(input);
      if (request.method === 'PUT') {
        writes++;
        layout = await request.json();
      }
      return Response.json(registration);
    }) as typeof fetch;
    const macro = new Macro({ token: 'user-token', hosts: { storage: host } });
    const form = macro.forms.byId(formId);
    const [section] = await form.sections();
    const [question] = await form.questions();
    if (!section || !question) throw new Error('Missing fixture layout');
    const column = await question.column();
    await form.replaceLayout([
      {
        kind: 'questions',
        section,
        title: 'Your badge',
        questions: [{ question, column, required: true, widget: 'short' }],
      },
    ]);
    expect(layout).toEqual({
      sections: [
        {
          kind: 'questions',
          id: sectionId,
          title: 'Your badge',
          description: '',
          questions: [
            {
              id: questionId,
              column: columnId,
              helpText: '',
              required: true,
              widget: 'short',
            },
          ],
        },
      ],
    });
    const otherForm = macro.forms.byId('0198a4cc-e138-7670-a308-a6b766603708');
    await expect(
      otherForm.replaceLayout([
        { kind: 'questions', section, title: 'Invalid', questions: [] },
      ]),
    ).rejects.toThrow('does not belong');
    expect(writes).toBe(1);
  });

  test('reads only the caller response endpoint and maps both receipt and question handles', async () => {
    const paths: string[] = [];
    globalThis.fetch = (async (input) => {
      const request = input instanceof Request ? input : new Request(input);
      const path = new URL(request.url).pathname;
      paths.push(path);
      if (path.endsWith('/responses/mine'))
        return Response.json({
          response: {
            id: responseId,
            formId,
            status: 'submitted',
            stoppedAtSection: null,
            row: rowId,
            submittedAt: '2026-10-05T12:00:00Z',
            updatedAt: '2026-10-05T12:01:00Z',
          },
          answers: [
            {
              question: questionId,
              value: { type: 'text', value: 'Ada Lovelace' },
            },
          ],
        });
      return Response.json(registration);
    }) as typeof fetch;
    const macro = new Macro({ token: 'user-token', hosts: { storage: host } });
    const form = macro.forms.byId(formId);
    const mine = await form.myResponse();
    expect(mine.response.form).toBe(form);
    expect(mine.response.id).toBe(responseId);
    expect(mine.row?.id).toBe(rowId);
    expect(mine.answers[0]?.question.id).toBe(questionId);
    expect(mine.answers[0]?.value).toEqual({
      type: 'text',
      value: 'Ada Lovelace',
    });
    expect(mine.stoppedAtSection).toBeUndefined();
    const [status, row, answers] = await Promise.all([
      mine.response.status(),
      mine.response.row(),
      mine.response.answers(),
    ]);
    expect(status).toBe('submitted');
    expect(row?.id).toBe(rowId);
    expect(answers).toEqual(mine.answers);
    expect(paths).toEqual([
      `/forms/${formId}/responses/mine`,
      `/forms/${formId}`,
    ]);
    await mine.response.refresh();
    expect(paths).toEqual([
      `/forms/${formId}/responses/mine`,
      `/forms/${formId}`,
      `/forms/${formId}/responses/mine`,
    ]);
  });

  test('edits responses with PUT and returns a stopped section without reading rows', async () => {
    const writes: { method: string; path: string; body: unknown }[] = [];
    globalThis.fetch = (async (input) => {
      const request = input instanceof Request ? input : new Request(input);
      if (request.method === 'GET') return Response.json(registration);
      writes.push({
        method: request.method,
        path: new URL(request.url).pathname,
        body: await request.json(),
      });
      return Response.json({
        outcome: 'stopped',
        section: sectionId,
        message: 'This workshop is full.',
      });
    }) as typeof fetch;
    const macro = new Macro({ token: 'user-token', hosts: { storage: host } });
    const form = macro.forms.byId(formId);
    const [question] = await form.questions();
    if (!question) throw new Error('Missing fixture question');
    const result = await form.editResponse([
      { question, value: { type: 'text', value: 'Ada' } },
    ]);
    if (result.outcome !== 'stopped')
      throw new Error('Expected a stopped edit');
    expect(result.section.form).toBe(form);
    expect(result.section.id).toBe(sectionId);
    expect(result.message).toBe('This workshop is full.');
    expect(writes).toEqual([
      {
        method: 'PUT',
        path: `/forms/${formId}/responses/mine`,
        body: {
          answers: [
            { question: questionId, value: { type: 'text', value: 'Ada' } },
          ],
        },
      },
    ]);
  });

  test('lists by database handle and reads summaries, tallies and permissions', async () => {
    const optionId = '0198a4cc-e138-7670-a308-a6b766603709';
    const permissions = {
      id: '0198a4cc-e138-7670-a308-a6b766603710',
      owner: 'macro|owner@example.test',
      channelSharePermissions: [],
    };
    const requests: { method: string; path: string; search: string }[] = [];
    globalThis.fetch = (async (input) => {
      const request = input instanceof Request ? input : new Request(input);
      const url = new URL(request.url);
      requests.push({
        method: request.method,
        path: url.pathname,
        search: url.search,
      });
      if (url.pathname === '/forms') return Response.json([registration.form]);
      if (url.pathname.endsWith('/responses/summary'))
        return Response.json({
          submitted: 3,
          stopped: 1,
          rows: 5,
          stoppedBySection: [{ section: sectionId, count: 1 }],
        });
      if (url.pathname.endsWith('/tally'))
        return Response.json({
          questions: [
            {
              question: questionId,
              responses: 3,
              buckets: [
                { value: { kind: 'option', option: optionId }, count: 2 },
                { value: { kind: 'checkbox', checked: false }, count: 1 },
              ],
            },
          ],
        });
      return Response.json(permissions);
    }) as typeof fetch;
    const macro = new Macro({ token: 'user-token', hosts: { storage: host } });
    const [form] = await macro.forms.list(macro.databases.byId(databaseId));
    if (!form) throw new Error('Missing listed form');
    const summary = await form.responseSummary();
    expect(summary.submitted).toBe(3);
    expect(summary.rows).toBe(5);
    expect(summary.stoppedBySection[0]?.section.id).toBe(sectionId);
    const [tally] = await form.tally();
    expect(tally?.question.id).toBe(questionId);
    const optionBucket = tally?.buckets[0];
    if (optionBucket?.value.kind !== 'option')
      throw new Error('Missing option bucket');
    expect(optionBucket.value.option.id).toBe(optionId);
    expect(optionBucket.value.option.question.id).toBe(questionId);
    expect(await form.sharePermissions()).toEqual(permissions);
    expect(
      await form.updateSharePermissions({ channelSharePermissions: [] }),
    ).toEqual(permissions);
    expect(requests).toEqual([
      { method: 'GET', path: '/forms', search: `?databaseId=${databaseId}` },
      { method: 'GET', path: `/forms/${formId}/responses/summary`, search: '' },
      { method: 'GET', path: `/forms/${formId}/tally`, search: '' },
      { method: 'GET', path: `/forms/${formId}/permissions`, search: '' },
      { method: 'PATCH', path: `/forms/${formId}/permissions`, search: '' },
    ]);
  });

  test('lists shared forms without requiring access to their databases', async () => {
    const paths: string[] = [];
    globalThis.fetch = (async (input) => {
      const request = input instanceof Request ? input : new Request(input);
      paths.push(new URL(request.url).pathname);
      return Response.json([{ form: registration.form, access: 'view' }]);
    }) as typeof fetch;

    const macro = new Macro({ token: 'user-token', hosts: { storage: host } });
    const [form] = await macro.forms.list();
    expect(form?.id).toBe(formId);
    expect(paths).toEqual(['/forms/accessible']);
  });
});

test('an accepted form response exposes its unlocked booking step', async () => {
  globalThis.fetch = (async (input) => {
    const request = input instanceof Request ? input : new Request(input);
    if (new URL(request.url).pathname.endsWith('/responses/mine')) return Response.json({
      response: { id: responseId, form: formId, row: rowId, status: 'submitted', stoppedAtSection: null,
        submittedAt: '2026-10-05T00:00:00Z', updatedAt: '2026-10-05T00:00:00Z' },
      answers: [],
      booking: { section: '0198a4cc-e138-7670-a308-a6b766603709', title: 'Book a conversation', description: 'Choose a time that works.',
        target: { profileId: '0198a4cc-e138-7670-a308-a6b76660370a', eventTypeId: '0198a4cc-e138-7670-a308-a6b76660370b' } },
    });
    if (request.method === 'POST') return Response.json({
      outcome: 'submitted', response: responseId, row: rowId,
      booking: {
        section: '0198a4cc-e138-7670-a308-a6b766603709',
        title: 'Book a conversation', description: 'Choose a time that works.',
        target: { profileId: '0198a4cc-e138-7670-a308-a6b76660370a', eventTypeId: '0198a4cc-e138-7670-a308-a6b76660370b' },
      },
    });
    return Response.json(registration);
  }) as typeof fetch;
  const macro = new Macro({ token: 'user-token', hosts: { storage: host } });
  const outcome = await macro.forms.byId(formId).submit([]);
  if (outcome.outcome !== 'submitted') throw new Error('Expected acceptance');
  expect(outcome.booking?.section.id).toBe('0198a4cc-e138-7670-a308-a6b766603709');
  expect(outcome.booking?.target).toEqual({ profileId: '0198a4cc-e138-7670-a308-a6b76660370a', eventTypeId: '0198a4cc-e138-7670-a308-a6b76660370b' });
  expect((await outcome.response.booking())?.title).toBe('Book a conversation');
  await outcome.response.refresh();
  expect((await outcome.response.booking())?.section.id).toBe('0198a4cc-e138-7670-a308-a6b766603709');
});
