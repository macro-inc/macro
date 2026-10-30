import type { EmailEntity } from '@entity/types/entity';
import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { EmailFilesToggleRow } from '../queries/email-search-files';
import { EmailSearchFileRow, EmailSearchFilesToggle } from './EmailSearchFiles';

vi.mock('@ui', async () => ({
  Button: (await import('@app/components/ui/components/Button')).Button,
  cn: (await import('@app/components/ui/utils/classname')).cn,
}));
vi.mock('@service-storage/websocket', () => ({
  storageWS: { reconnectIfDisconnected: vi.fn() },
  createWebSocketJob: vi.fn(),
}));
vi.mock('@service-connection/websocket', () => ({
  ws: { addEventListener: vi.fn(), send: vi.fn() },
  state: () => 'closed',
  createConnectionBlockWebsocketEffect: vi.fn(),
  createConnectionWebsocketEffect: vi.fn(),
}));

afterEach(cleanup);

const thread: EmailEntity = {
  type: 'email',
  id: 'thread',
  name: 'Quarterly numbers',
  ownerId: 'viewer',
  isRead: true,
  isDraft: false,
  isImportant: true,
  done: false,
};

describe('email search files', () => {
  it('opens the file from its row and the email from its own action', () => {
    const onOpen = vi.fn();
    const onOpenEmail = vi.fn();
    render(() => (
      <EmailSearchFileRow
        row={{
          kind: 'email-file',
          id: 'email-file:a',
          file: {
            attachmentId: 'a',
            filename: 'Q3 report.pdf',
            mimeType: 'application/pdf',
            matchesQuery: true,
            sender: 'Jackson Smith',
            sentAt: new Date(2020, 4, 17),
            thread,
          },
        }}
        highlighted={false}
        onHover={() => {}}
        onOpen={onOpen}
        onOpenEmail={onOpenEmail}
      />
    ));

    expect(screen.getByText('Q3 report.pdf')).toBeTruthy();
    expect(screen.getByText('Jackson Smith · 5/17/20')).toBeTruthy();

    const openEmail = screen.getByRole('button', { name: 'Open email' });
    fireEvent.click(openEmail);
    expect(onOpenEmail).toHaveBeenCalledOnce();
    expect(onOpen).not.toHaveBeenCalled();

    fireEvent.click(screen.getByText('Q3 report.pdf'));
    expect(onOpen).toHaveBeenCalledOnce();
    expect(onOpenEmail).toHaveBeenCalledOnce();
  });

  it('expands and collapses the overflow from the toggle row', () => {
    const [row, setRow] = createSignal<EmailFilesToggleRow>({
      kind: 'email-files-toggle',
      id: 'email-files-toggle',
      hiddenCount: 2,
      expanded: false,
    });
    render(() => (
      <EmailSearchFilesToggle
        row={row()}
        highlighted={false}
        onHover={() => {}}
        onToggle={() => setRow({ ...row(), expanded: !row().expanded })}
      />
    ));

    fireEvent.click(screen.getByText('Show 2 more files'));
    expect(screen.getByText('Show fewer files')).toBeTruthy();
    expect(screen.getByRole('gridcell').getAttribute('aria-expanded')).toBe(
      'true'
    );

    fireEvent.click(screen.getByText('Show fewer files'));
    expect(screen.getByText('Show 2 more files')).toBeTruthy();
  });
});
