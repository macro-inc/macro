import { cleanup, render, within } from '@solidjs/testing-library';
import { afterEach, expect, it } from 'vitest';
import { setViewportWidth } from '../../../../app/utils/utilBreakpoint';
import {
  documentComparisons,
  emailComparisons,
  taskComparisons,
} from '../../core/feature-comparisons';
import { CallsComparison } from '../calls/CallsComparison';
import { CrmComparison } from '../crm/CrmComparison';
import { FeatureComparisons } from './FeatureComparisons';

afterEach(cleanup);

it('shows one table with all email competitors with a heading and no disclosure', () => {
  setViewportWidth(1440);
  const view = render(() => (
    <FeatureComparisons
      title="Compare Email Clients"
      comparisons={emailComparisons}
    />
  ));
  const table = view.getByRole('region', { name: 'Compare Macro' });
  expect(view.container.querySelector('details')).toBeNull();
  expect(
    view.getByRole('heading', { name: 'Compare Email Clients', level: 2 })
  ).toBeTruthy();
  expect(within(table).getByText('Superhuman Mail')).toBeTruthy();
  expect(within(table).getByText('Gmail')).toBeTruthy();
  let accountCell = within(table).getByText(
    'Manage multiple email accounts'
  ).nextElementSibling;
  for (let index = 0; index < 3; index++) {
    expect(accountCell?.querySelector('[aria-label="Yes"]')).toBeTruthy();
    accountCell = accountCell?.nextElementSibling ?? null;
  }
  expect(
    within(table).getAllByText('Keyboard navigation and command menu')
  ).toHaveLength(1);
  expect(
    within(table).getAllByRole('img', { name: 'Yes' }).length
  ).toBeGreaterThan(0);
  expect(
    within(table).getAllByRole('img', { name: 'No' }).length
  ).toBeGreaterThan(0);
});

it('combines Linear and Jira in one mobile-scrollable table', () => {
  setViewportWidth(390);
  const view = render(() => (
    <FeatureComparisons
      title="Compare Task Managers"
      comparisons={taskComparisons}
    />
  ));
  const table = view.getByRole('region', { name: 'Compare Macro' });
  expect(within(table).getByText('Linear')).toBeTruthy();
  expect(within(table).getByText('Jira')).toBeTruthy();
  expect(table.tabIndex).toBe(0);
  expect(table.style.overflowX).toBe('auto');
  expect(view.container.querySelector('#compare-linear')).toBeTruthy();
  expect(view.container.querySelector('#compare-jira')).toBeTruthy();
});

it('credits shared CRM capabilities and competitors’ dedicated reporting', () => {
  setViewportWidth(390);
  const view = render(() => <CrmComparison />);
  expect(
    view.getByRole('heading', { name: 'Compare CRMs', level: 2 })
  ).toBeTruthy();
  const table = view.getByRole('region', { name: 'Compare Macro' });
  expect(view.container.querySelector('details')).toBeNull();
  expect(within(table).getByText('Features')).toBeTruthy();
  expect(table.querySelector('[title$="logo placeholder"]')).toBeNull();
  for (const label of ['Macro', 'Salesforce', 'HubSpot', 'Attio']) {
    expect(within(table).getByText(label)).toBeTruthy();
  }
  const contacts = within(table).getByText('Sales pipelines and custom fields');
  let cell = contacts.nextElementSibling;
  for (let index = 0; index < 4; index++) {
    expect(cell?.querySelector('[aria-label="Yes"]')).toBeTruthy();
    cell = cell?.nextElementSibling ?? null;
  }
  const reports = within(table).getByText('Sales reporting');
  cell = reports.nextElementSibling;
  expect(
    cell
      ?.querySelector('[aria-label="Partial"]')
      ?.getAttribute('aria-description')
  ).toContain('no dedicated sales reporting dashboard');
  for (let index = 0; index < 3; index++) {
    cell = cell?.nextElementSibling ?? null;
    expect(cell?.querySelector('[aria-label="Yes"]')).toBeTruthy();
  }
  expect(view.getByText('Partial')).toBeTruthy();
  expect(view.queryByText('Not included')).toBeNull();
  expect(table.tabIndex).toBe(0);
  expect(table.style.overflowX).toBe('auto');
  expect(view.queryByText(/Includes paid features/)).toBeNull();
});

it('explains Gmail’s partial keyboard workflow without denying its shortcuts', () => {
  setViewportWidth(1440);
  const view = render(() => (
    <FeatureComparisons
      title="Compare Email Clients"
      comparisons={emailComparisons}
    />
  ));
  const keyboard = view.getByText('Keyboard navigation and command menu');
  const gmail =
    keyboard.nextElementSibling?.nextElementSibling?.nextElementSibling;
  expect(
    gmail
      ?.querySelector('[aria-label="Partial"]')
      ?.getAttribute('aria-description')
  ).toContain('Gmail supports navigation and action shortcuts');
});

it('credits Notion’s task and CRM databases while explaining the setup difference', () => {
  setViewportWidth(1440);
  const view = render(() => (
    <FeatureComparisons
      title="Compare Workspaces"
      comparisons={documentComparisons}
    />
  ));
  const task = view.getByText('Dedicated task manager');
  const crm = view.getByText('Dedicated CRM');
  const taskMark = task.nextElementSibling?.nextElementSibling?.querySelector(
    '[aria-label="Partial"]'
  );
  const crmMark = crm.nextElementSibling?.nextElementSibling?.querySelector(
    '[aria-label="Partial"]'
  );
  expect(taskMark?.getAttribute('aria-description')).toContain(
    'task databases, My tasks, and sprints'
  );
  expect(crmMark?.getAttribute('aria-description')).toContain(
    'databases and templates'
  );
  const collaboration = view.getByText('Live document collaboration');
  expect(
    collaboration.nextElementSibling?.nextElementSibling?.querySelector(
      '[aria-label="Yes"]'
    )
  ).toBeTruthy();
});

it('credits connected Granola notes without claiming native external-meeting capture', () => {
  setViewportWidth(1440);
  const view = render(() => <CallsComparison />);
  const row = view.getByText('Capture notes in other meeting apps');
  const macro = row.nextElementSibling?.querySelector('[aria-label="Partial"]');
  expect(macro?.getAttribute('aria-description')).toContain(
    'Granola captures the meeting'
  );
  expect(macro?.getAttribute('aria-description')).toContain(
    'does not record other meeting apps itself'
  );
  expect(
    row.nextElementSibling?.nextElementSibling?.nextElementSibling?.querySelector(
      '[aria-label="Yes"]'
    )
  ).toBeTruthy();
});
