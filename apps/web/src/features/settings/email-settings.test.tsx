/**
 * @vitest-environment jsdom
 */

import { cleanup, render, screen } from '@solidjs/testing-library';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EmailSettings } from './email-settings';

const mocks = vi.hoisted(() => ({
  query: {} as Record<string, unknown>,
}));

vi.mock('@app/lib/analytics/posthog', () => ({
  useFeatureFlag: () => () => ({ enabled: true }),
}));
vi.mock('@core/component/Toast/Toast', () => ({
  toast: { success: vi.fn(), failure: vi.fn() },
}));
vi.mock('@core/constant/SettingsState', () => ({
  useSettingsState: () => ({ openSettings: vi.fn() }),
}));
vi.mock('@core/constant/settingsTabsConfig', () => ({
  useSettingsTabAvailable: () => () => false,
}));
vi.mock('@core/context/user', () => ({
  useUserId: () => () => 'macro|owner@example.com',
}));
vi.mock('@core/email-link', () => ({
  useEmailLinks: () => ({ query: mocks.query }),
}));
vi.mock('@queries/email/settings', () => ({
  useUpdateEmailSettingsMutation: () => ({ isPending: false, mutate: vi.fn() }),
}));
vi.mock('./Email', () => ({ EmailCard: () => null }));
vi.mock('./SignatureSection', () => ({
  SignatureSection: (props: {
    link: { email_address: string };
    shared?: boolean;
  }) => {
    const row = document.createElement('p');
    row.textContent = `Signature for ${props.link.email_address}${props.shared ? ', shared' : ''}`;
    return row;
  },
}));

const link = {
  id: 'link-1',
  macro_id: 'macro|owner@example.com',
  email_address: 'owner@example.com',
  settings: { read_receipts_enabled: true },
};

afterEach(() => {
  cleanup();
});

describe('EmailSettings read receipts', () => {
  it('keeps cached account switches when a refetch fails', () => {
    mocks.query = {
      isPending: false,
      isError: true,
      isSuccess: false,
      data: { links: [link] },
      refetch: vi.fn(),
    };
    render(() => <EmailSettings />);

    expect(
      screen.getByRole('switch', {
        name: 'Read receipts for owner@example.com',
      })
    ).toBeTruthy();
    expect(screen.queryByText("Couldn't load accounts")).toBeNull();
  });

  it('offers a retry only when no accounts have loaded', () => {
    mocks.query = {
      isPending: false,
      isError: true,
      isSuccess: false,
      data: undefined,
      refetch: vi.fn(),
    };
    render(() => <EmailSettings />);

    expect(screen.getByText("Couldn't load accounts")).toBeTruthy();
    expect(screen.queryByRole('switch')).toBeNull();
  });
});

describe('EmailSignatures', () => {
  it('lists shared inboxes beside owned ones and marks them shared', () => {
    mocks.query = {
      isPending: false,
      isError: false,
      isSuccess: true,
      data: {
        links: [
          link,
          {
            id: 'link-2',
            macro_id: 'macro|helpdesk@example.com',
            email_address: 'helpdesk@example.com',
            settings: { read_receipts_enabled: true },
          },
        ],
      },
      refetch: vi.fn(),
    };
    render(() => <EmailSettings />);

    expect(screen.getByText('Signature for owner@example.com')).toBeTruthy();
    expect(
      screen.getByText('Signature for helpdesk@example.com, shared')
    ).toBeTruthy();
  });
});
