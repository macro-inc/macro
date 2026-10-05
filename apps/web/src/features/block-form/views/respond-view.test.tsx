import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@solidjs/testing-library';
import { errAsync } from 'neverthrow';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { FormProvider } from '../context/form-context';
import type { FormDetail } from '../core/form-model';
import { createMockFormContext } from '../tests/mock-context';
import { RespondView } from './respond-view';

afterEach(cleanup);

// jsdom has no layout, so no scrolling into view.
beforeAll(() => {
  Element.prototype.scrollIntoView = () => {};
});

function offsite(): FormDetail {
  return {
    form: {
      id: 'form-1',
      name: 'Q4 offsite RSVP',
      description: 'Tell us if you can come.',
      ownerId: 'macro|owner@example.com',
      databaseId: 'database-1',
      tableId: 'table-1',
      audience: 'members',
      status: 'open',
      closesAt: null,
      tallyVisible: false,
      confirmationMessage: 'See you there!',
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
              helpText: 'First and last',
              required: true,
              widget: 'short',
            },
            {
              id: 'q-team',
              columnId: 'team',
              helpText: '',
              required: true,
              widget: 'choice',
            },
          ],
        },
        {
          id: 'gate',
          title: 'Eligibility',
          description: '',
          kind: 'gate',
          gateRules: {
            conjunction: 'and',
            conditions: [
              {
                kind: 'condition',
                column: 'team',
                test: {
                  kind: 'options',
                  operator: 'isNoneOf',
                  options: ['contractor'],
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
              columnId: 'diet',
              helpText: '',
              required: false,
              widget: 'paragraph',
            },
          ],
        },
      ],
    },
    columns: [
      { id: 'name', name: 'Name', kind: { type: 'text' }, options: [] },
      {
        id: 'team',
        name: 'Team',
        kind: { type: 'select', multi: false },
        options: [
          { id: 'contractor', label: 'Contractor', color: null },
          { id: 'employee', label: 'Employee', color: null },
        ],
      },
      {
        id: 'diet',
        name: 'Dietary needs',
        kind: { type: 'text' },
        options: [],
      },
    ],
    access: 'view',
    tableGone: false,
  };
}

describe('RespondView', () => {
  it('answers section by section, submits once, and shows the confirmation with the receipt', async () => {
    const { context, calls } = createMockFormContext({ detail: offsite() });
    render(() => (
      <FormProvider value={context}>
        <RespondView
          detail={offsite()}
          compact={false}
          refetch={async () => true}
        />
      </FormProvider>
    ));
    expect(screen.getByText('Section 1 of 2')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Next/ }));
    expect(screen.getAllByText('This question is required.')).toHaveLength(2);
    fireEvent.input(screen.getByLabelText(/^Name/), {
      target: { value: 'Ada Lovelace' },
    });
    fireEvent.click(screen.getByLabelText('Employee'));
    fireEvent.click(screen.getByRole('button', { name: /Next/ }));
    expect(screen.getByText('Section 2 of 2')).toBeTruthy();
    fireEvent.input(screen.getByLabelText('Dietary needs'), {
      target: { value: 'Vegetarian' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Submit/ }));
    expect(await screen.findByText('See you there!')).toBeTruthy();
    expect(calls.submitted).toEqual([
      [
        { question: 'q-name', value: { type: 'text', value: 'Ada Lovelace' } },
        {
          question: 'q-team',
          value: { type: 'options', value: [{ id: 'employee' }] },
        },
        { question: 'q-diet', value: { type: 'text', value: 'Vegetarian' } },
      ],
    ]);
    expect(screen.getByText('Vegetarian')).toBeTruthy();
    expect(
      screen.getByRole('button', { name: 'Edit my response' })
    ).toBeTruthy();
  });

  it('stops at the gate with its message, never its rules, and sends nothing', () => {
    const { context, calls } = createMockFormContext({ detail: offsite() });
    render(() => (
      <FormProvider value={context}>
        <RespondView
          detail={offsite()}
          compact={false}
          refetch={async () => true}
        />
      </FormProvider>
    ));
    fireEvent.input(screen.getByLabelText(/^Name/), {
      target: { value: 'Ada' },
    });
    fireEvent.click(screen.getByLabelText('Contractor'));
    fireEvent.click(screen.getByRole('button', { name: /Next/ }));
    expect(screen.getByText('This form can’t take your response')).toBeTruthy();
    expect(screen.getByText('The offsite is for employees.')).toBeTruthy();
    expect(screen.queryByText(/isNoneOf|Contractor/)).toBeNull();
    expect(calls.submitted).toEqual([]);
    fireEvent.click(screen.getByRole('button', { name: 'Check my answers' }));
    expect(screen.getByText('Section 1 of 2')).toBeTruthy();
  });

  it('offers a signed-in respondent stopped at a gate a message to the owner', () => {
    const { context, calls } = createMockFormContext({ detail: offsite() });
    render(() => (
      <FormProvider value={context}>
        <RespondView
          detail={offsite()}
          compact={false}
          refetch={async () => true}
        />
      </FormProvider>
    ));
    fireEvent.input(screen.getByLabelText(/^Name/), {
      target: { value: 'Ada' },
    });
    fireEvent.click(screen.getByLabelText('Contractor'));
    fireEvent.click(screen.getByRole('button', { name: /Next/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Message the owner' }));
    expect(calls.messagedOwners).toEqual(['macro|owner@example.com']);
  });

  it('offers an anonymous visitor no message to the owner', () => {
    const detail = offsite();
    detail.form.audience = 'public';
    const { context } = createMockFormContext({ detail, viewerId: undefined });
    render(() => (
      <FormProvider value={context}>
        <RespondView
          detail={detail}
          compact={false}
          refetch={async () => true}
        />
      </FormProvider>
    ));
    fireEvent.input(screen.getByLabelText(/^Name/), {
      target: { value: 'Ada' },
    });
    fireEvent.click(screen.getByLabelText('Contractor'));
    fireEvent.click(screen.getByRole('button', { name: /Next/ }));
    expect(screen.getByText('This form can’t take your response')).toBeTruthy();
    expect(
      screen.queryByRole('button', { name: 'Message the owner' })
    ).toBeNull();
  });

  it('asks anonymous visitors to sign in for a question that picks people, instead of a picker they can’t use', () => {
    const detail = offsite();
    detail.form.audience = 'public';
    detail.columns.push({
      id: 'host',
      name: 'Your host',
      kind: { type: 'entity', target: 'USER', multi: false },
      options: [],
    });
    detail.layout.sections[0].questions.push({
      id: 'q-host',
      columnId: 'host',
      helpText: '',
      required: false,
      widget: null,
    });
    const { context } = createMockFormContext({ detail, viewerId: undefined });
    render(() => (
      <FormProvider value={context}>
        <RespondView
          detail={detail}
          compact={false}
          refetch={async () => true}
        />
      </FormProvider>
    ));
    expect(
      screen.getByText(
        '“Your host” picks from Macro, which needs you to sign in.'
      )
    ).toBeTruthy();
  });

  it('lands a signed-in respondent of a public form on their saved response, editable', () => {
    const detail = offsite();
    detail.form.audience = 'public';
    const { context } = createMockFormContext({
      detail,
      mine: {
        status: 'submitted',
        submittedAt: '2026-10-01T09:00:00Z',
        answers: [
          { question: 'q-name', value: { type: 'text', value: 'Ada' } },
          {
            question: 'q-team',
            value: { type: 'options', value: [{ id: 'employee' }] },
          },
        ],
      },
    });
    render(() => (
      <FormProvider value={context}>
        <RespondView
          detail={detail}
          compact={false}
          refetch={async () => true}
        />
      </FormProvider>
    ));
    expect(screen.getByText('Ada')).toBeTruthy();
    expect(
      screen.getByRole('button', { name: 'Edit my response' })
    ).toBeTruthy();
  });

  it('shows a closed form’s saved response with the reason it can no longer be edited', () => {
    const detail = offsite();
    detail.form.status = 'closed';
    const { context } = createMockFormContext({
      detail,
      mine: {
        status: 'submitted',
        submittedAt: '2026-10-01T09:00:00Z',
        answers: [
          { question: 'q-name', value: { type: 'text', value: 'Ada' } },
        ],
      },
    });
    render(() => (
      <FormProvider value={context}>
        <RespondView
          detail={detail}
          compact={false}
          refetch={async () => true}
        />
      </FormProvider>
    ));
    expect(
      screen.getByText(
        'This form is closed, so your response can’t be changed.'
      )
    ).toBeTruthy();
    expect(screen.getByText('Ada')).toBeTruthy();
    expect(screen.queryByText(/you can edit your response/)).toBeNull();
    expect(
      screen.queryByRole('button', { name: 'Edit my response' })
    ).toBeNull();
  });

  it('tells the respondent when Try again could not read the form, and keeps their answers', async () => {
    const detail = offsite();
    const base = createMockFormContext({ detail });
    const { context, calls } = createMockFormContext({
      detail,
      overrides: {
        responses: {
          ...base.context.responses,
          submit: () =>
            errAsync({ message: 'Changed.', refusal: 'invalid-layout' }),
        },
      },
    });
    const reads: (() => Promise<boolean>)[] = [
      async () => true, // the read after the refusal
      async () => false, // Try again: the read failed
      async () => {
        throw new Error('offline');
      },
      async () => true,
    ];
    const refetch = () => (reads.shift() ?? (async () => true))();
    render(() => (
      <FormProvider value={context}>
        <RespondView detail={detail} compact={false} refetch={refetch} />
      </FormProvider>
    ));
    fireEvent.input(screen.getByLabelText(/^Name/), {
      target: { value: 'Ada' },
    });
    fireEvent.click(screen.getByLabelText('Employee'));
    fireEvent.click(screen.getByRole('button', { name: /Next/ }));
    fireEvent.click(screen.getByRole('button', { name: /Submit/ }));
    const retry = await screen.findByRole('button', { name: 'Try again' });
    fireEvent.click(retry);
    await waitFor(() =>
      expect(calls.notices).toEqual([
        '✗ The form couldn’t be read again. Try again in a moment.',
      ])
    );
    expect(screen.getByText('This form is being updated')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(calls.notices).toHaveLength(2));
    expect(screen.getByText('This form is being updated')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('Section 1 of 2')).toBeTruthy();
    expect(screen.getByLabelText<HTMLInputElement>(/^Name/).value).toBe('Ada');
  });

  it('tells anonymous visitors of a public form only that answers are required', () => {
    const detail = offsite();
    detail.form.audience = 'public';
    const { context } = createMockFormContext({ detail, viewerId: undefined });
    render(() => (
      <FormProvider value={context}>
        <RespondView
          detail={detail}
          compact={false}
          refetch={async () => true}
        />
      </FormProvider>
    ));
    expect(screen.getByText('* required')).toBeTruthy();
  });

  it('says a closed form is closed', () => {
    const detail = offsite();
    detail.form.status = 'closed';
    const { context } = createMockFormContext({ detail, mine: null });
    render(() => (
      <FormProvider value={context}>
        <RespondView
          detail={detail}
          compact={false}
          refetch={async () => true}
        />
      </FormProvider>
    ));
    expect(screen.getByText('This form is closed.')).toBeTruthy();
  });
});
