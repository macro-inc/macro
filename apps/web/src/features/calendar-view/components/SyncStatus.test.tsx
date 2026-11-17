/**
 * @vitest-environment jsdom
 */

import type { Link as EmailLink } from '@service-email/generated/schemas';
import { cleanup, render, screen } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const [links, setLinks] = createSignal<EmailLink[]>([]);
const [linksLoaded, setLinksLoaded] = createSignal(true);

vi.mock('@queries/email/link', () => ({
  useEmailLinksQuery: () => ({
    get isSuccess() {
      return linksLoaded();
    },
    get data() {
      return { links: links() };
    },
  }),
}));

import { SyncStatus } from './SyncStatus';

const REST =
  'This may take a while, and some days may look empty until the import finishes. You can keep using Macro.';

const link = (
  id: string,
  provider: EmailLink['provider'],
  overrides: Partial<EmailLink> = {}
): EmailLink =>
  ({
    id,
    provider,
    macro_id: 'macro|self',
    email_address: `${id}@example.com`,
    ...overrides,
  }) as unknown as EmailLink;

const status = () => screen.getByRole('status').textContent;

beforeEach(() => {
  setLinks([]);
  setLinksLoaded(true);
});

afterEach(() => {
  cleanup();
});

describe('SyncStatus', () => {
  it('names Outlook when every inbox is on Outlook', () => {
    setLinks([link('work', 'OUTLOOK')]);
    render(() => <SyncStatus syncing />);

    expect(status()).toBe(
      `Syncing your calendar…Events are still being imported from Outlook. ${REST}`
    );
    expect(status()).not.toContain('Google');
  });

  it('names Google when every inbox is on Google', () => {
    setLinks([link('personal', 'GMAIL'), link('work', 'GMAIL')]);
    render(() => <SyncStatus syncing />);

    expect(status()).toContain('Events are still being imported from Google.');
  });

  it('names no provider when inboxes are on different providers', () => {
    setLinks([
      link('personal', 'GMAIL'),
      link('shared', 'OUTLOOK', { macro_id: 'macro|someone-else' }),
    ]);
    render(() => <SyncStatus syncing />);

    expect(status()).toBe(
      `Syncing your calendar…Events are still being imported. ${REST}`
    );
  });

  it('names no provider until the inboxes load, then names theirs', () => {
    setLinksLoaded(false);
    setLinks([link('work', 'OUTLOOK')]);
    render(() => <SyncStatus syncing />);

    expect(status()).toContain('Events are still being imported. ');
    setLinksLoaded(true);
    expect(status()).toContain('Events are still being imported from Outlook.');
  });

  it('never suggests turning the calendar off', () => {
    setLinks([link('work', 'OUTLOOK')]);
    render(() => <SyncStatus syncing />);

    expect(status()?.toLowerCase()).not.toMatch(/turn|disable|remove|off/);
  });

  it('disappears once the import finishes', () => {
    const [syncing, setSyncing] = createSignal(true);
    setLinks([link('work', 'OUTLOOK')]);
    render(() => <SyncStatus syncing={syncing()} />);

    expect(screen.getByRole('status')).toBeTruthy();
    setSyncing(false);
    expect(screen.queryByRole('status')).toBeNull();
  });
});
