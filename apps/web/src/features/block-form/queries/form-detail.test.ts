import { describe, expect, it } from 'vitest';
import {
  toFormDetail,
  toFormLayout,
  toLayoutDocument,
  toMyResponse,
  toSubmitOutcome,
} from './form-detail';

it('refuses to send a gate without rules rather than inventing an empty rule group', () => {
  expect(() =>
    toLayoutDocument({
      sections: [
        {
          id: 'gate',
          title: '',
          description: '',
          kind: 'gate',
          gateRules: null,
          gateMessage: 'Not this time.',
          bookingTarget: null,
          questions: [],
        },
      ],
    })
  ).toThrow('Gate “gate” has no rules');
});

it('reads the shared layout document as the builder edits it, and writes it back unchanged', () => {
  const document = {
    sections: [
      {
        kind: 'questions' as const,
        id: 'about',
        title: 'About you',
        description: 'Who is coming.',
        questions: [
          {
            id: 'q-name',
            column: 'column-name',
            helpText: 'First and last',
            required: true,
            widget: 'short' as const,
          },
          {
            id: 'q-team',
            column: 'column-team',
            helpText: '',
            required: false,
            widget: null,
          },
        ],
      },
      {
        kind: 'gate' as const,
        id: 'gate',
        title: 'Eligibility',
        description: '',
        rules: {
          conjunction: 'or' as const,
          conditions: [
            {
              kind: 'condition' as const,
              column: 'column-team',
              test: {
                kind: 'presence' as const,
                operator: 'isNotEmpty' as const,
              },
            },
          ],
        },
        message: 'Employees only.',
      },
      {
        kind: 'booking' as const,
        id: 'call',
        title: 'Book a call',
        description: '',
        target: { profileId: 'profile-1', eventTypeId: 'intro-call' },
      },
    ],
  };
  const layout = toFormLayout(document);
  expect(layout.sections.map((section) => section.kind)).toEqual([
    'questions',
    'gate',
    'booking',
  ]);
  expect(layout.sections[0].questions[0]).toEqual({
    id: 'q-name',
    columnId: 'column-name',
    helpText: 'First and last',
    required: true,
    widget: 'short',
  });
  expect(layout.sections[1].gateMessage).toBe('Employees only.');
  expect(layout.sections[2].bookingTarget).toEqual({
    profileId: 'profile-1',
    eventTypeId: 'intro-call',
  });
  expect(toLayoutDocument(layout)).toEqual(document);
});

describe('the booking step', () => {
  const form = {
    id: 'form-1',
    name: 'Design partner intake',
    description: '',
    ownerId: 'macro|owner@example.com',
    databaseId: 'database-1',
    tableId: 'table-1',
    audience: 'public',
    status: 'open',
    closesAt: null,
    tallyVisible: false,
    confirmationMessage: '',
    submittedColumnId: null,
    respondentColumnId: null,
    createdAt: '2026-10-01T12:00:00Z',
    updatedAt: '2026-10-01T12:00:00Z',
  } as const;

  it('reads an editor’s booking step with its target and writes it back', () => {
    const detail = toFormDetail({
      form,
      access: 'owner',
      tableGone: false,
      sections: [
        {
          kind: 'booking',
          id: 'call',
          title: 'Book a call',
          description: 'Thirty minutes with the team.',
          target: { profileId: 'profile-1', eventTypeId: 'intro-call' },
        },
      ],
    });
    expect(detail.layout).toEqual({
      sections: [
        {
          id: 'call',
          title: 'Book a call',
          description: 'Thirty minutes with the team.',
          kind: 'booking',
          gateRules: null,
          gateMessage: '',
          bookingTarget: { profileId: 'profile-1', eventTypeId: 'intro-call' },
          questions: [],
        },
      ],
    });
    expect(toLayoutDocument(detail.layout)).toEqual({
      sections: [
        {
          kind: 'booking',
          id: 'call',
          title: 'Book a call',
          description: 'Thirty minutes with the team.',
          target: { profileId: 'profile-1', eventTypeId: 'intro-call' },
        },
      ],
    });
  });

  it('reads a respondent’s booking step without a target, and never writes one it lacks', () => {
    const detail = toFormDetail({
      form,
      access: 'view',
      tableGone: false,
      sections: [
        {
          kind: 'booking',
          id: 'call',
          title: 'Book a call',
          description: '',
        },
      ],
    });
    expect(detail.layout.sections[0].bookingTarget).toBeNull();
    expect(() => toLayoutDocument(detail.layout)).toThrow(
      'Booking step “call” has no booking link'
    );
  });

  it('unlocks the booking step only from an accepted submission or a passing saved response', () => {
    expect(
      toSubmitOutcome({
        outcome: 'submitted',
        response: 'response-1',
        row: 'row-1',
        booking: {
          section: 'call',
          title: 'Book a call',
          description: '',
          target: { profileId: 'profile-1', eventTypeId: 'intro-call' },
        },
      })
    ).toEqual({
      kind: 'submitted',
      responseId: 'response-1',
      booking: {
        sectionId: 'call',
        title: 'Book a call',
        description: '',
        target: { profileId: 'profile-1', eventTypeId: 'intro-call' },
      },
    });
    expect(
      toSubmitOutcome({
        outcome: 'submitted',
        response: 'response-2',
        row: 'row-2',
      })
    ).toEqual({ kind: 'submitted', responseId: 'response-2', booking: null });
    expect(
      toSubmitOutcome({
        outcome: 'stopped',
        section: 'fit',
        message: 'Not a fit yet.',
      })
    ).toEqual({ kind: 'stopped', sectionId: 'fit', message: 'Not a fit yet.' });
    expect(
      toMyResponse({
        response: {
          id: 'response-1',
          formId: 'form-1',
          status: 'submitted',
          stoppedAtSection: null,
          row: 'row-1',
          submittedAt: '2026-10-01T12:00:00Z',
          updatedAt: '2026-10-01T12:00:00Z',
        },
        answers: [],
        booking: {
          section: 'call',
          title: 'Book a call',
          description: '',
          target: { profileId: 'profile-1', eventTypeId: 'intro-call' },
        },
      })
    ).toEqual({
      status: 'submitted',
      submittedAt: '2026-10-01T12:00:00Z',
      answers: [],
      booking: {
        sectionId: 'call',
        title: 'Book a call',
        description: '',
        target: { profileId: 'profile-1', eventTypeId: 'intro-call' },
      },
    });
  });
});
