import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@solidjs/testing-library';
import { createSignal, type JSX, Show } from 'solid-js';
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
  EmailAttachmentPill: (props: {
    attachment: { fileName: string };
    onClick?: (chip: HTMLElement) => void;
    onDownload?: () => void;
  }) => (
    <>
      <button
        type="button"
        onClick={(event) => props.onClick?.(event.currentTarget)}
      >
        {props.attachment.fileName}
      </button>
      <Show when={props.onDownload}>
        <button type="button" onClick={() => props.onDownload?.()}>
          Download {props.attachment.fileName}
        </button>
      </Show>
    </>
  ),
}));
vi.mock('@core/component/ImageGalleryPreview', () => ({
  ImageGalleryPreview: () => null,
}));
vi.mock('@core/component/VideoPreview', () => ({ VideoPreview: () => null }));
vi.mock('../components/calendar-invite-card', () => ({
  CalendarInviteCard: () => null,
}));
afterEach(cleanup);

const calendarFile = {
  db_id: 'ics',
  filename: 'Planning.ics',
  mime_type: 'text/calendar',
};
const pdfFile = {
  db_id: 'pdf',
  filename: 'Agenda.pdf',
  mime_type: 'application/pdf',
};

function message(invitations: CalendarInvitation[]): EmailMessage {
  return {
    db_id: 'message',
    attachments: [calendarFile, pdfFile],
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

it('opens a calendar file as the event it holds and other files through the host', () => {
  const onOpenAttachment = vi.fn();
  const onDownloadAttachment = vi.fn();
  render(() => (
    <EmailMessageView
      message={message([invitationFixture])}
      renderInvitation={(_message, invitation) => (
        <div data-testid="card">{invitation.id}</div>
      )}
      onOpenAttachment={onOpenAttachment}
      onDownloadAttachment={onDownloadAttachment}
      isTouch={false}
      isPersonal={false}
      isSelected={false}
      allowHover={false}
      isExpanded
    />
  ));
  fireEvent.click(screen.getByRole('button', { name: /^Planning\.ics$/ }));
  const preview = screen.getByRole('dialog');
  expect(preview.textContent).toContain(invitationFixture.id);
  fireEvent.click(screen.getByRole('button', { name: 'Download .ics' }));
  expect(onDownloadAttachment).toHaveBeenCalledWith(calendarFile);
  expect(onOpenAttachment).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Close' }));
  expect(screen.queryByRole('dialog')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: /^Agenda\.pdf$/ }));
  expect(onOpenAttachment).toHaveBeenCalledWith(pdfFile);
});

it('tells the card when it is shown inside its calendar file', () => {
  render(() => (
    <EmailMessageView
      message={message([invitationFixture])}
      renderInvitation={(_message, invitation, options) => (
        <div data-testid="card">
          {options?.inCalendarFile ? 'in file' : 'inline'} {invitation.id}
        </div>
      )}
      onOpenAttachment={vi.fn()}
      onDownloadAttachment={vi.fn()}
      isTouch={false}
      isPersonal={false}
      isSelected={false}
      allowHover={false}
      isExpanded
    />
  ));
  expect(screen.getByTestId('card').textContent).toContain('inline');
  fireEvent.click(screen.getByRole('button', { name: /^Planning\.ics$/ }));
  expect(screen.getByRole('dialog').textContent).toContain('in file');
});

it('hands a calendar file without a readable event to the host', () => {
  const onOpenAttachment = vi.fn();
  render(() => (
    <EmailMessageView
      message={message([])}
      onOpenAttachment={onOpenAttachment}
      isTouch={false}
      isPersonal={false}
      isSelected={false}
      allowHover={false}
      isExpanded
    />
  ));
  fireEvent.click(screen.getByRole('button', { name: /^Planning\.ics$/ }));
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(onOpenAttachment).toHaveBeenCalledWith(calendarFile);
});

it('keeps the opened calendar file card mounted when the thread refreshes the message', () => {
  const [current, setCurrent] = createSignal(message([invitationFixture]));
  render(() => (
    <EmailMessageView
      message={current()}
      renderInvitation={(_message, invitation, options) => (
        <div data-testid={options ? 'dialog-card' : 'card'}>
          {invitation.id}
        </div>
      )}
      onOpenAttachment={vi.fn()}
      isTouch={false}
      isPersonal={false}
      isSelected={false}
      allowHover={false}
      isExpanded
    />
  ));
  fireEvent.click(screen.getByRole('button', { name: /^Planning\.ics$/ }));
  const card = screen.getByTestId('dialog-card');
  setCurrent(message([structuredClone(invitationFixture)]));
  expect(screen.getByTestId('dialog-card')).toBe(card);
});

it('returns focus to the calendar file chip when its dialog closes', async () => {
  render(() => (
    <EmailMessageView
      message={message([invitationFixture])}
      renderInvitation={(_message, invitation) => <div>{invitation.id}</div>}
      onOpenAttachment={vi.fn()}
      isTouch={false}
      isPersonal={false}
      isSelected={false}
      allowHover={false}
      isExpanded
    />
  ));
  const chip = screen.getByRole('button', { name: /^Planning\.ics$/ });
  fireEvent.click(chip);
  fireEvent.click(screen.getByRole('button', { name: 'Close' }));
  expect(screen.queryByRole('dialog')).toBeNull();
  await waitFor(() => expect(document.activeElement).toBe(chip));

  chip.blur();
  fireEvent.click(chip);
  fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
  expect(screen.queryByRole('dialog')).toBeNull();
  await waitFor(() => expect(document.activeElement).toBe(chip));
});

it('keeps the chip to return focus to when the thread refreshes its attachments', async () => {
  const [current, setCurrent] = createSignal(message([invitationFixture]));
  render(() => (
    <EmailMessageView
      message={current()}
      renderInvitation={(_message, invitation) => <div>{invitation.id}</div>}
      onOpenAttachment={vi.fn()}
      isTouch={false}
      isPersonal={false}
      isSelected={false}
      allowHover={false}
      isExpanded
    />
  ));
  const chip = screen.getByRole('button', { name: /^Planning\.ics$/ });
  fireEvent.click(chip);
  setCurrent({
    ...message([invitationFixture]),
    attachments: [structuredClone(calendarFile), structuredClone(pdfFile)],
  });
  // The open dialog hides the page behind it from the accessibility tree.
  expect(
    screen.getByRole('button', { name: /^Planning\.ics$/, hidden: true })
  ).toBe(chip);
  fireEvent.click(screen.getByRole('button', { name: 'Close' }));
  await waitFor(() => expect(document.activeElement).toBe(chip));
});

it('closes the calendar file dialog when its card opens the calendar', async () => {
  let navigate: (() => void) | undefined;
  render(() => (
    <EmailMessageView
      message={message([invitationFixture])}
      renderInvitation={(_message, invitation, options) => {
        if (options) navigate = options.onNavigate;
        return <div>{invitation.id}</div>;
      }}
      onOpenAttachment={vi.fn()}
      isTouch={false}
      isPersonal={false}
      isSelected={false}
      allowHover={false}
      isExpanded
    />
  ));
  const chip = screen.getByRole('button', { name: /^Planning\.ics$/ });
  fireEvent.click(chip);
  expect(screen.getByRole('dialog')).toBeTruthy();
  navigate?.();
  expect(screen.queryByRole('dialog')).toBeNull();
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(document.activeElement).not.toBe(chip);
});

it('opens a cloud-reference calendar file through the host', () => {
  const reference = {
    ...calendarFile,
    reference_url: 'https://outlook.office.com/mail/item',
  };
  const onOpenAttachment = vi.fn();
  render(() => (
    <EmailMessageView
      message={
        {
          ...message([invitationFixture]),
          attachments: [reference],
        } as unknown as EmailMessage
      }
      renderInvitation={(_message, invitation) => <div>{invitation.id}</div>}
      onOpenAttachment={onOpenAttachment}
      isTouch={false}
      isPersonal={false}
      isSelected={false}
      allowHover={false}
      isExpanded
    />
  ));
  fireEvent.click(screen.getByRole('button', { name: /^Planning\.ics$/ }));
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(onOpenAttachment).toHaveBeenCalledWith(reference);
});

it('downloads every attachment type from its chip and skips cloud references', () => {
  const onOpenAttachment = vi.fn();
  const onDownloadAttachment = vi.fn();
  const image = {
    db_id: 'img',
    filename: 'photo.png',
    mime_type: 'image/png',
    sfs_id: 'sfs-photo',
  };
  const video = {
    db_id: 'vid',
    filename: 'clip.mp4',
    mime_type: 'video/mp4',
    sfs_id: 'sfs-clip',
  };
  const reference = {
    ...calendarFile,
    reference_url: 'https://outlook.office.com/mail/item',
  };
  render(() => (
    <EmailMessageView
      message={
        {
          ...message([]),
          attachments: [pdfFile, image, video, reference],
        } as unknown as EmailMessage
      }
      onOpenAttachment={onOpenAttachment}
      onDownloadAttachment={onDownloadAttachment}
      isTouch={false}
      isPersonal={false}
      isSelected={false}
      allowHover={false}
      isExpanded
    />
  ));
  fireEvent.click(screen.getByRole('button', { name: 'Download Agenda.pdf' }));
  fireEvent.click(screen.getByRole('button', { name: 'Download photo.png' }));
  fireEvent.click(screen.getByRole('button', { name: 'Download clip.mp4' }));
  expect(
    screen.queryByRole('button', { name: 'Download Planning.ics' })
  ).toBeNull();
  expect(onDownloadAttachment.mock.calls).toEqual([
    [pdfFile],
    [image],
    [video],
  ]);
  expect(onOpenAttachment).not.toHaveBeenCalled();
});
