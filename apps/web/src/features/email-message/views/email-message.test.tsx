import { cleanup, render, screen } from '@solidjs/testing-library';
import { createSignal, type JSX } from 'solid-js';
import { afterEach, expect, it, vi } from 'vitest';
import type { CalendarInvitation } from '../core/calendar-invitation';
import { invitationFixture } from '../core/calendar-invitation-fixtures';
import type { EmailMessage } from '../core/email-message';
import { EmailMessageView } from './email-message';

vi.mock('@app/features/email-message/components/message-card', () => ({
  MessageCard: (props: { children: JSX.Element }) => (
    <div>{props.children}</div>
  ),
}));
vi.mock('@app/features/email-message/components/email-message-top-bar', () => ({
  EmailMessageTopBar: () => null,
}));
vi.mock('@app/features/email-message/views/email-message-body', () => ({
  EmailMessageBody: () => null,
}));
vi.mock('@app/features/email-message/components/collapsed-message', () => ({
  CollapsedMessage: () => null,
}));
vi.mock('@app/features/email-message/components/attachment-pill', () => ({
  EmailAttachmentPill: () => null,
}));
vi.mock('@core/component/ImageGalleryPreview', () => ({
  ImageGalleryPreview: () => null,
}));
vi.mock('@core/component/VideoPreview', () => ({ VideoPreview: () => null }));
vi.mock('../components/calendar-invite-card', () => ({
  CalendarInviteCard: () => null,
}));
afterEach(cleanup);

function message(invitations: CalendarInvitation[]): EmailMessage {
  return {
    db_id: 'message',
    attachments: [],
    attachments_draft: [],
    attachments_forwarded: [],
    calendar_invitations: invitations,
  } as unknown as EmailMessage;
}

it('keeps invitation cards mounted when the thread refreshes the message', () => {
  const [current, setCurrent] = createSignal(message([invitationFixture]));
  const renderInvitation = vi.fn(
    (_message: EmailMessage, invitation: CalendarInvitation) => (
      <div data-testid="card">{invitation.id}</div>
    )
  );
  render(() => (
    <EmailMessageView
      message={current()}
      renderInvitation={renderInvitation}
      isTouch={false}
      isPersonal={false}
      isSelected={false}
      allowHover={false}
      isExpanded
    />
  ));
  const card = screen.getByTestId('card');
  setCurrent(message([structuredClone(invitationFixture)]));
  expect(screen.getByTestId('card')).toBe(card);
  expect(renderInvitation).toHaveBeenCalledOnce();
});
