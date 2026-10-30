import { cleanup, render, within } from '@solidjs/testing-library';
import { afterEach, expect, it } from 'vitest';
import { setViewportWidth } from '../../../../app/utils/utilBreakpoint';
import { migrationComparisons } from '../../core/migration-comparisons';
import { FeatureComparisons } from './FeatureComparisons';

afterEach(cleanup);

it('uses the framed comparison with plain headers and feature labels', () => {
  setViewportWidth(1440);
  const view = render(() => (
    <FeatureComparisons
      title="Compare all tools"
      comparisons={migrationComparisons}
      tableMinWidth={900}
    />
  ));
  const table = view.getByRole('region', { name: 'Compare Macro' });
  expect(table.getAttribute('data-presentation')).toBe('framed');
  expect(table.querySelectorAll('a')).toHaveLength(0);
  for (const name of [
    'Macro',
    'Superhuman Mail',
    'Notion',
    'Slack',
    'Linear',
    'ClickUp',
  ])
    expect(within(table).getByText(name)).toBeTruthy();
  expect(within(table).getByText('Features')).toBeTruthy();
  expect(view.getByText('Partial')).toBeTruthy();
});

it('credits CRM templates and Salesforce-backed CRM with explained partial marks', () => {
  setViewportWidth(390);
  const view = render(() => (
    <FeatureComparisons
      title="Compare all tools"
      comparisons={migrationComparisons}
      tableMinWidth={900}
    />
  ));
  const table = view.getByRole('region', { name: 'Compare Macro' });
  let cell = within(table).getByText('Dedicated CRM').nextElementSibling;
  const cells: Element[] = [];
  for (let index = 0; index < 6; index++) {
    if (!cell) throw new Error('Missing CRM comparison cell');
    cells.push(cell);
    cell = cell.nextElementSibling;
  }
  expect(cells[0].querySelector('[aria-label="Yes"]')).toBeTruthy();
  expect(cells[1].querySelector('[aria-label="No"]')).toBeTruthy();
  expect(
    cells[2]
      .querySelector('[aria-label="Partial"]')
      ?.getAttribute('aria-description')
  ).toContain('Notion databases');
  expect(
    cells[3]
      .querySelector('[aria-label="Partial"]')
      ?.getAttribute('aria-description')
  ).toContain('Salesforce Free Edition');
  expect(cells[4].querySelector('[aria-label="No"]')).toBeTruthy();
  expect(
    cells[5]
      .querySelector('[aria-label="Partial"]')
      ?.getAttribute('aria-description')
  ).toContain('custom fields');
  expect(table.style.overflowX).toBe('auto');
  expect(table.firstElementChild?.getAttribute('style')).toContain(
    'min-width: 900px'
  );
});
