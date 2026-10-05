import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FormProvider } from '../context/form-context';
import type { FormDetail } from '../core/form-model';
import { createMockFormContext } from '../tests/mock-context';
import { FormPageView } from './form-page-view';

afterEach(cleanup);

function offsite(access: FormDetail['access']): FormDetail {
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
      confirmationMessage: '',
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
              required: false,
              widget: 'dropdown',
            },
          ],
        },
        {
          id: 'eligibility',
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
          id: 'travel',
          title: 'Travel',
          description: '',
          kind: 'questions',
          gateRules: null,
          gateMessage: '',
          questions: [
            {
              id: 'q-arrival',
              columnId: 'arrival',
              helpText: '',
              required: true,
              widget: 'date',
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
          { id: 'design', label: 'Design', color: null },
          { id: 'contractor', label: 'Contractor', color: null },
        ],
      },
      { id: 'arrival', name: 'Arrival', kind: { type: 'date' }, options: [] },
    ],
    access,
    tableGone: false,
  };
}

function renderPage(
  detail: FormDetail,
  tab: 'build' | 'responses' | 'share',
  handlers: {
    onTabChange?: (tab: 'build' | 'responses' | 'share') => void;
    onOpenDatabase?: (databaseId: string) => void;
  } = {}
) {
  const { context, source } = createMockFormContext({
    detail,
    overrides: {
      responses: {
        createSummary: () => ({
          value: () => ({
            submitted: 12,
            stopped: 3,
            stoppedBySection: [{ sectionId: 'eligibility', count: 3 }],
            rows: 15,
          }),
          failure: () => undefined,
        }),
      },
    },
  });
  render(() => (
    <FormProvider value={context}>
      <FormPageView
        source={source}
        tab={tab}
        respondLink="https://macro.com/app/form/form-1/respond"
        onTabChange={handlers.onTabChange ?? (() => {})}
        onOpenDatabase={handlers.onOpenDatabase ?? (() => {})}
        onOpenShare={() => {}}
        onTrashed={() => {}}
      />
    </FormProvider>
  ));
}

describe('FormPageView before the responses grid', () => {
  it('shows viewers the sections and questions without tabs or counts', () => {
    renderPage(offsite('view'), 'build');

    expect(screen.queryByRole('tablist')).toBeNull();
    expect(screen.queryByRole('list', { name: 'Response counts' })).toBeNull();

    const sections = screen.getAllByRole('region');
    expect(
      sections.map((section) => section.getAttribute('aria-label'))
    ).toEqual([
      'Section 1 of 2: About you',
      'Gate 1: Eligibility',
      'Section 2 of 2: Travel',
    ]);
    const about = sections[0];
    const questions = Array.from(about.querySelectorAll('li')).map(
      (item) => item.textContent
    );
    expect(questions).toEqual([
      'Name*First and lastShort answer',
      'TeamDropdown',
    ]);
    expect(sections[1].textContent).toContain(
      'Respondents who don’t pass see: The offsite is for employees.'
    );
    expect(sections[2].textContent).toContain('Arrival');
    expect(screen.getByText('2 sections · 3 questions · 1 gate')).toBeTruthy();
  });

  it('counts responses on the Responses tab and opens the database', () => {
    const onOpenDatabase = vi.fn();
    renderPage(offsite('edit'), 'responses', { onOpenDatabase });

    expect(screen.getByRole('tab', { name: /Responses/ }).textContent).toBe(
      'Responses12'
    );
    const counts = screen.getByRole('list', { name: 'Response counts' });
    expect(
      Array.from(counts.querySelectorAll('li')).map((item) => item.textContent)
    ).toEqual([
      '12Submitted',
      '3Stopped at Eligibility',
      '15Rows in the table',
    ]);
    fireEvent.click(screen.getByRole('button', { name: 'Open database' }));
    expect(onOpenDatabase).toHaveBeenCalledWith('database-1');
  });

  it('switches tabs from the tab strip', () => {
    const onTabChange = vi.fn();
    renderPage(offsite('owner'), 'share', { onTabChange });

    fireEvent.click(screen.getByRole('tab', { name: 'Build' }));
    expect(onTabChange).toHaveBeenCalledWith('build');
  });

  it('shows who can respond on the Share tab', () => {
    renderPage(offsite('owner'), 'share');

    expect(
      screen.getByRole('heading', { name: 'Who can respond' })
    ).toBeTruthy();
    expect(screen.queryByRole('region', { name: /Section 1/ })).toBeNull();
  });
});
