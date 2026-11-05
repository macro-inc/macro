/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { afterEach, expect, it } from 'vitest';
import { OrgSetupNote } from './org-setup-note';

const setup = {
  summary: 'An admin allows it once.',
  steps: ['Open settings.', 'Add the URL below.'],
  settings_url: 'https://vendor.example/settings',
  required: true,
  allowlist_url: 'https://connect.example/v1/oauth/callback',
};

afterEach(cleanup);

it('opens to the steps, the URL to add, and the settings link', () => {
  render(() => <OrgSetupNote setup={setup} />);
  expect(screen.queryByText(setup.summary)).toBeNull();

  fireEvent.click(screen.getByText('Needs your admin first'));

  expect(screen.getByText(setup.summary)).toBeTruthy();
  expect(screen.getByText(setup.steps[1])).toBeTruthy();
  expect(screen.getByText(setup.allowlist_url)).toBeTruthy();
  expect(screen.getByText('Where to do this').getAttribute('href')).toBe(
    setup.settings_url
  );
});
