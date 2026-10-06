import { cleanup, render, screen } from '@solidjs/testing-library';
import { afterEach, describe, expect, it } from 'vitest';
import { FormAccessOutcome } from './AccessOutcome';
import { MutationDetails } from './ResultDetails';
import type { FormMutation } from './types';

const result: FormMutation = {
  operationId: '0199bfee-1000-7000-8000-000000000001',
  formId: '0199bfee-1000-7000-8000-000000000002',
  state: 'completed',
  phase: 'completed',
  keys: { columns: {}, options: {}, questions: {}, sections: {} },
  diagnostics: [],
  saved: {
    revision: '0199bfee-1000-7000-8000-000000000003',
    projected: true,
    editorUrl: '/app/form/intake',
    respondentUrl: '/app/form/intake/respond',
    acceptingResponses: true,
    capabilities: {
      presentationLabels: false,
      conditionalColumnCleanup: false,
      safeLinkedTypeChanges: false,
      requiredBookingQualification: false,
    },
    form: {
      id: '0199bfee-1000-7000-8000-000000000002',
      name: 'Startup intake',
      description: '',
      ownerId: 'macro|owner@macro.com',
      databaseId: '0199bfee-1000-7000-8000-000000000004',
      tableId: '0199bfee-1000-7000-8000-000000000005',
      audience: 'public',
      status: 'open',
      closesAt: null,
      tallyVisible: false,
      confirmationMessage: '',
      submittedColumnId: null,
      respondentColumnId: null,
      createdAt: '2026-10-06T12:00:00Z',
      updatedAt: '2026-10-06T12:00:00Z',
    },
    columns: [
      {
        id: '0199bfee-1000-7000-8000-000000000006',
        name: 'Annual revenue',
        kind: { type: 'number' },
        options: [],
      },
    ],
    layout: {
      sections: [
        {
          kind: 'questions',
          id: '0199bfee-1000-7000-8000-000000000007',
          title: 'Company',
          description: '',
          questions: [
            {
              id: '0199bfee-1000-7000-8000-000000000008',
              column: '0199bfee-1000-7000-8000-000000000006',
              required: true,
              helpText: 'Last fiscal year',
              widget: null,
            },
          ],
        },
      ],
    },
  },
};
afterEach(cleanup);
describe('Forms saved results', () => {
  it('renders the actual questions, availability and canonical links', () => {
    render(() => <MutationDetails result={result} />);
    expect(screen.getByText('Startup intake')).toBeTruthy();
    expect(screen.getByText(/Annual revenue \(required\)/)).toBeTruthy();
    expect(screen.getByText(/Accepting responses/)).toBeTruthy();
    expect(
      screen.getByRole('link', { name: 'Respondent link' }).getAttribute('href')
    ).toBe('/app/form/intake/respond');
  });
  it('retains the saved result in a completed session review', () => {
    render(() => <FormAccessOutcome result={result} />);
    expect(screen.getByRole('link', { name: 'Respondent link' })).toBeTruthy();
  });
  it('shows partial outcome guidance without inventing a saved link', () => {
    render(() => (
      <FormAccessOutcome
        result={{
          ...result,
          state: 'partiallyApplied',
          phase: 'schemaApplied',
          saved: null,
          diagnostics: [
            {
              code: 'Unavailable',
              path: 'draft',
              message:
                'The columns were saved, but the draft write was interrupted.',
            },
          ],
        }}
      />
    ));
    expect(screen.getByText(/draft write was interrupted/)).toBeTruthy();
    expect(screen.getByText(/inspect this operation/)).toBeTruthy();
    expect(screen.queryByRole('link')).toBeNull();
  });
});
