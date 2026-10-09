import { cleanup, fireEvent, render } from '@solidjs/testing-library';
import { afterEach, expect, it } from 'vitest';
import { setViewportWidth } from '../../utils/utilBreakpoint';
import { MigrationPaths } from './MigrationPaths';

afterEach(cleanup);

function setup() {
  setViewportWidth(1440);
  const view = render(() => (
    <MigrationPaths helpHref="https://cal.com/team/macro/macro-demo-call" />
  ));
  return view;
}

it('lets a visitor find CSV imports and contextual help', () => {
  const view = setup();
  const email = view.getByRole('tab', { name: 'Email' });
  email.focus();
  fireEvent.keyDown(email, { key: 'ArrowRight' });
  expect(
    view.getByRole('heading', { name: 'Bring your files and records' })
  ).toBeTruthy();
  expect(
    view.getByRole('heading', { name: 'Tables and exported data' })
  ).toBeTruthy();
  expect(
    view.getByRole('link', { name: 'Talk to our team →' }).getAttribute('href')
  ).toBe('https://cal.com/team/macro/macro-demo-call');
});

it('explains agent-assisted imports without embedding product comparisons', () => {
  const view = setup();
  fireEvent.click(view.getByRole('tab', { name: 'Docs & tasks' }));
  expect(
    view.getByRole('heading', { name: 'Notion pages' }).parentElement
      ?.textContent
  ).toContain('ask an agent');
  expect(
    view.getByRole('heading', { name: 'Linear tasks' }).parentElement
      ?.textContent
  ).toContain('supported task properties');
  expect(view.queryByText('Compare Macro with Notion')).toBeNull();
  expect(view.queryByText('Compare Macro with Linear')).toBeNull();
  expect(view.getByRole('link', { name: 'See import details' })).toBeTruthy();
});

it('preserves the other-tools route when the viewport becomes compact', async () => {
  const view = setup();
  fireEvent.click(view.getByRole('tab', { name: 'Other tools' }));
  setViewportWidth(390);
  const trigger = view.getByRole('button', { name: 'Other tools' });
  expect(
    view.getByRole('region', { name: 'Bring over Other tools' })
  ).toBeTruthy();
  expect(
    view.getByRole('link', { name: 'Talk to our team →' }).getAttribute('href')
  ).toBe('https://cal.com/team/macro/macro-demo-call');
  fireEvent.keyDown(trigger, { key: 'ArrowUp' });
  await Promise.resolve();
  fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
  expect(document.activeElement).toBe(trigger);
  expect(view.queryByRole('menu')).toBeNull();
});
