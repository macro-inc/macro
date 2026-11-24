import { cleanup, render, screen } from '@solidjs/testing-library';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  connectMailbox: vi.fn(),
  mutate: vi.fn(),
  privacyFailed: false,
  policyFailed: false,
  mailboxEmail: null as string | null,
  mailboxLinkId: null as string | null,
}));

vi.mock('@app/lib/analytics/posthog', () => ({
  useFeatureFlag: () => () => ({ enabled: false, loading: false }),
}));
vi.mock('@app/observability/flow', () => ({ usePending: () => {} }));
vi.mock('../context/crm-context', () => ({
  useCrmContext: () => ({
    connectMailbox: state.connectMailbox,
    createEmailPolicy: () => ({
      scope: () => 'team-1',
      query: {
        isPending: false,
        isLoading: false,
        isError: state.policyFailed,
        data: state.policyFailed
          ? undefined
          : { mode: 'all', enabled: false, mailbox_email: state.mailboxEmail },
        refetch: vi.fn(),
      },
    }),
    createEmailPrivacy: () => ({
      query: {
        isPending: false,
        isSuccess: !state.privacyFailed,
        isError: state.privacyFailed,
        data: state.privacyFailed
          ? undefined
          : {
              enabled: false,
              mailboxEmail: state.mailboxEmail,
              mailboxLinkId: state.mailboxLinkId,
              teamDomains: [],
              personalDomains: [],
              canRemoveTeamDomains: false,
            },
        refetch: vi.fn(),
      },
      update: { isPending: false, mutate: state.mutate },
      createExcludedThreads: vi.fn(),
    }),
  }),
}));

import { CrmEmailPrivacySettings } from './email-privacy';

afterEach(() => {
  cleanup();
  state.connectMailbox.mockReset();
  state.mutate.mockReset();
  state.privacyFailed = false;
  state.policyFailed = false;
  state.mailboxEmail = null;
  state.mailboxLinkId = null;
});

it('offers a keyboard-operable Connect email that starts the mailbox connection without opting in', async () => {
  const user = userEvent.setup();
  render(() => <CrmEmailPrivacySettings />);

  const connect = screen.getByRole('button', { name: 'Connect email' });
  await user.tab();
  expect(document.activeElement).toBe(connect);
  await user.keyboard('{Enter}');

  expect(state.connectMailbox).toHaveBeenCalledTimes(1);
  expect(state.mutate).not.toHaveBeenCalled();
  expect(
    screen.getByRole<HTMLButtonElement>('button', {
      name: 'Share my emails with CRM',
    }).disabled
  ).toBe(true);
});

it('leaves a connected mailbox with sharing off and no Connect email', () => {
  state.mailboxEmail = 'member@example.com';
  state.mailboxLinkId = '00000000-0000-4000-8000-000000000045';
  render(() => <CrmEmailPrivacySettings />);

  screen.getByText('member@example.com');
  screen.getByText('Sharing off');
  expect(screen.queryByRole('button', { name: 'Connect email' })).toBeNull();
  expect(
    screen.getByRole<HTMLButtonElement>('button', {
      name: 'Share my emails with CRM',
    }).disabled
  ).toBe(false);
  expect(state.mutate).not.toHaveBeenCalled();
});

it('keeps the load error and retry without offering Connect email for an unknown mailbox', () => {
  state.privacyFailed = true;
  render(() => <CrmEmailPrivacySettings />);

  screen.getByText('Email settings could not be loaded.');
  screen.getByRole('button', { name: 'Retry' });
  expect(screen.queryByRole('button', { name: 'Connect email' })).toBeNull();
});

it('keeps the policy error alert and the disabled opt-in beside Connect email', () => {
  state.policyFailed = true;
  render(() => <CrmEmailPrivacySettings />);

  expect(screen.getByRole('alert').textContent).toBe(
    'Email settings could not be loaded.'
  );
  expect(
    screen.getByRole<HTMLButtonElement>('button', { name: 'Connect email' })
      .disabled
  ).toBe(false);
  expect(
    screen.getByRole<HTMLButtonElement>('button', {
      name: 'Share my emails with CRM',
    }).disabled
  ).toBe(true);
});
