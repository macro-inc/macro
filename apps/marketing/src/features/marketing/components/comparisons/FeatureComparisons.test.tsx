import { cleanup, render, within } from '@solidjs/testing-library';
import { afterEach, expect, it } from 'vitest';
import { setViewportWidth } from '../../../../app/utils/utilBreakpoint';
import {
  emailComparisons,
  taskComparisons,
} from '../../core/feature-comparisons';
import { FeatureComparisons } from './FeatureComparisons';

afterEach(cleanup);

it('shows one table with all email competitors and no disclosure or heading', () => {
  setViewportWidth(1440);
  const view = render(() => (
    <FeatureComparisons comparisons={emailComparisons} />
  ));
  const table = view.getByRole('region', { name: 'Compare Macro' });
  expect(view.container.querySelector('details')).toBeNull();
  expect(view.queryByRole('heading')).toBeNull();
  expect(within(table).getByText('Superhuman Mail')).toBeTruthy();
  expect(within(table).getByText('Gmail')).toBeTruthy();
  expect(within(table).getAllByText('Keyboard shortcuts')).toHaveLength(1);
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
    <FeatureComparisons comparisons={taskComparisons} />
  ));
  const table = view.getByRole('region', { name: 'Compare Macro' });
  expect(within(table).getByText('Linear')).toBeTruthy();
  expect(within(table).getByText('Jira')).toBeTruthy();
  expect(table.tabIndex).toBe(0);
  expect(table.style.overflowX).toBe('auto');
  expect(view.container.querySelector('#compare-linear')).toBeTruthy();
  expect(view.container.querySelector('#compare-jira')).toBeTruthy();
});
