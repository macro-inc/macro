/**
 * @vitest-environment jsdom
 */

import type { TeamInviteDetails } from '@service-auth/generated/schemas/teamInviteDetails';
import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TeamInviteRow } from './team-invite-row';

vi.mock('@entity', () => ({
  formatRelativeTimestamp: () => '1h',
}));
vi.mock('@core/util/webOrigin', () => ({
  getWebOrigin: () => 'https://macro.com',
}));

const HOUR = 60 * 60 * 1000;

function invite(lastSentHoursAgo: number): TeamInviteDetails {
  const lastSent = new Date(Date.now() - lastSentHoursAgo * HOUR).toISOString();
  return {
    id: 'invite-1',
    email: 'teammate@acme.com',
    team_id: 'team-1',
    team_role: 'member',
    invited_by: 'macro|owner@acme.com',
    created_at: lastSent,
    last_sent_at: lastSent,
  };
}

function renderRow(lastSentHoursAgo: number) {
  const onResend = vi.fn();
  render(() => (
    <TeamInviteRow
      invite={invite(lastSentHoursAgo)}
      canChange
      resending={false}
      onResend={onResend}
      onCancel={vi.fn()}
    />
  ));
  return { onResend, resend: screen.getByLabelText('Resend invite') };
}

describe('TeamInviteRow', () => {
  afterEach(cleanup);

  it('resends an invite whose last email is over an hour old', () => {
    const { onResend, resend } = renderRow(72);

    fireEvent.click(resend);

    expect(onResend).toHaveBeenCalledOnce();
  });

  it('keeps Resend off inside the email rate limit', () => {
    const { onResend, resend } = renderRow(0.25);

    expect((resend as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(resend);
    expect(onResend).not.toHaveBeenCalled();
  });

  it('shows when the invite was last sent', () => {
    renderRow(0.25);

    expect(screen.getByText(/Invited as member · sent 1h/)).toBeTruthy();
  });

  it('names every icon-only action', () => {
    renderRow(72);

    expect(screen.getByLabelText('Copy invite link')).toBeTruthy();
    expect(screen.getByLabelText('Cancel invite')).toBeTruthy();
  });
});
