import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
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
          bookingTarget: null,
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
        booking: null,
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
        booking: null,
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

  it('places required-field guidance below the questions without promising anonymous editing', () => {
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
    const guidance = screen.getByRole('note', { name: 'Form guidance' });
    expect(within(guidance).getByText('Required fields')).toBeTruthy();
    const question = screen.getByLabelText(/^Name/);
    expect(
      question.compareDocumentPosition(guidance) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    expect(screen.queryByText(/you can edit your response/i)).toBeNull();
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

  describe('a booking step', () => {
    const INTRO_CALL = { profileId: 'profile-1', eventTypeId: 'intro-call' };
    const UNLOCKED = {
      sectionId: 'call',
      title: 'Book a call',
      description: 'Thirty minutes with the team.',
      target: INTRO_CALL,
    };
    const events = {
      'intro-call': {
        profile: {
          id: 'profile-1',
          name: 'Ada Lovelace',
          description: '',
          eventTypes: [],
        },
        event: {
          id: 'intro-call',
          title: 'Intro call',
          slug: 'intro',
          description: 'A short hello.',
          durationMinutes: 30,
          location: '',
          googleMeet: true,
          questions: [],
          requiresConfirmation: false,
          mode: 'individual' as const,
        },
      },
    };

    /** The offsite form, one section, then the booking step. */
    function booked(target: typeof INTRO_CALL | null = null): FormDetail {
      const detail = offsite();
      detail.layout.sections = [
        detail.layout.sections[0],
        {
          id: 'call',
          title: 'Book a call',
          description: 'Thirty minutes with the team.',
          kind: 'booking',
          gateRules: null,
          gateMessage: '',
          bookingTarget: target,
          questions: [],
        },
      ];
      return detail;
    }

    function answer(team: 'Employee' | 'Contractor') {
      fireEvent.input(screen.getByLabelText(/^Name/), {
        target: { value: 'Ada Lovelace' },
      });
      fireEvent.click(screen.getByLabelText(team));
    }

    it('reads the booking link only after the server accepts the response, then shows the native calendar', async () => {
      const { context, calls } = createMockFormContext({
        detail: booked(),
        viewerId: undefined,
        submitOutcome: {
          kind: 'submitted',
          responseId: 'response-1',
          booking: UNLOCKED,
        },
        booking: { events },
      });
      render(() => (
        <FormProvider value={context}>
          <RespondView
            detail={booked()}
            compact={false}
            refetch={async () => true}
          />
        </FormProvider>
      ));
      answer('Employee');
      expect(calls.bookingEventsRead).toEqual([]);
      fireEvent.click(
        screen.getByRole('button', { name: 'Continue to booking' })
      );
      expect(
        await screen.findByRole('heading', { name: 'Book a call' })
      ).toBeTruthy();
      expect(screen.getByRole('heading', { name: 'Intro call' })).toBeTruthy();
      expect(screen.getByText('Select a date & time')).toBeTruthy();
      expect(calls.submitted).toHaveLength(1);
      expect(calls.bookingEventsRead).toContainEqual(INTRO_CALL);
    });

    it('shows the stop screen when the server stops the response, never reading a booking link', async () => {
      const { context, calls } = createMockFormContext({
        detail: booked(),
        submitOutcome: {
          kind: 'stopped',
          sectionId: 'gate',
          message: 'Not a fit yet.',
        },
        booking: { events },
      });
      render(() => (
        <FormProvider value={context}>
          <RespondView
            detail={booked()}
            compact={false}
            refetch={async () => true}
          />
        </FormProvider>
      ));
      answer('Employee');
      fireEvent.click(
        screen.getByRole('button', { name: 'Continue to booking' })
      );
      expect(await screen.findByText('Not a fit yet.')).toBeTruthy();
      expect(screen.queryByText('Select a date & time')).toBeNull();
      expect(calls.bookingEventsRead).toEqual([]);
    });

    it('offers a returning respondent the booking step their saved response still unlocks', async () => {
      const { context } = createMockFormContext({
        detail: booked(),
        mine: {
          status: 'submitted',
          submittedAt: '2026-10-01T09:00:00Z',
          answers: [
            { question: 'q-name', value: { type: 'text', value: 'Ada' } },
          ],
          booking: UNLOCKED,
        },
        booking: { events },
      });
      render(() => (
        <FormProvider value={context}>
          <RespondView
            detail={booked()}
            compact={false}
            refetch={async () => true}
          />
        </FormProvider>
      ));
      fireEvent.click(screen.getByRole('button', { name: 'Book a time' }));
      expect(
        await screen.findByRole('heading', { name: 'Intro call' })
      ).toBeTruthy();
    });

    it('says when the booking link was turned off, keeping the saved response', async () => {
      const { context } = createMockFormContext({
        detail: booked(),
        viewerId: undefined,
        submitOutcome: {
          kind: 'submitted',
          responseId: 'response-1',
          booking: UNLOCKED,
        },
        booking: { events: {} },
      });
      render(() => (
        <FormProvider value={context}>
          <RespondView
            detail={booked()}
            compact={false}
            refetch={async () => true}
          />
        </FormProvider>
      ));
      answer('Employee');
      fireEvent.click(
        screen.getByRole('button', { name: 'Continue to booking' })
      );
      expect(
        await screen.findByText(/This booking link is no longer available/)
      ).toBeTruthy();
      expect(
        screen.getByText(/Your response is saved/).getAttribute('role')
      ).toBe('status');
    });

    it('previews the editor’s calendar after the answers pass locally, saving and booking nothing', async () => {
      const { context, calls } = createMockFormContext({
        detail: booked(INTRO_CALL),
        booking: { events },
      });
      render(() => (
        <FormProvider value={context}>
          <RespondView
            detail={booked(INTRO_CALL)}
            compact={false}
            preview
            refetch={async () => true}
          />
        </FormProvider>
      ));
      answer('Employee');
      fireEvent.click(
        screen.getByRole('button', { name: 'Continue to booking' })
      );
      expect(
        await screen.findByRole('heading', { name: 'Intro call' })
      ).toBeTruthy();
      expect(
        screen.getByText(
          'Preview: browse the real availability. Nothing is booked.'
        )
      ).toBeTruthy();
      expect(calls.submitted).toEqual([]);
      expect(calls.booked).toEqual([]);
      fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
      expect(screen.getByLabelText(/^Name/)).toBeTruthy();
    });
  });
});
