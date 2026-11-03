import { cleanup, render, screen } from '@solidjs/testing-library';
import { createSignal, type JSX } from 'solid-js';
import { afterEach, expect, it, vi } from 'vitest';
import type { EmailMessage } from '../core/email-message';
import { formatShortDateTime } from '../core/format-email-date';
import type { ReadReceipt } from '../core/read-receipt';
import { EmailMessageTopBar } from './email-message-top-bar';

vi.mock('./email-user-tooltip', () => ({
  EmailUserTooltip: (props: { children: JSX.Element }) => props.children,
}));

afterEach(cleanup);

const message = {
  db_id: 'sent',
  from: { email: 'me@example.com', name: 'Me' },
  to: [{ email: 'ada@example.com', name: 'Ada' }],
  cc: [],
  bcc: [],
  internal_date_ts: '2026-10-20T09:00:00Z',
} as unknown as EmailMessage;

function renderTopBar(readReceipt?: ReadReceipt) {
  const [expandedHeader, setExpandedHeader] = createSignal(true);
  return render(() => (
    <EmailMessageTopBar
      message={message}
      focused={false}
      viewerEmail="me@example.com"
      isTouch={false}
      readReceipt={readReceipt}
      setExpandedBodyId={() => {}}
      isBodyExpanded={() => true}
      expandedHeader={expandedHeader}
      setExpandedHeader={setExpandedHeader}
      setFocusedMessageId={() => {}}
    />
  ));
}

it('shows no read status for untracked messages', () => {
  renderTopBar();
  expect(screen.queryByText('Opened')).toBeNull();
  expect(screen.queryByText('Not opened')).toBeNull();
});

it('labels an unopened tracked message', () => {
  renderTopBar({ openCount: 0 });
  expect(screen.getByText('Not opened')).toBeTruthy();
  expect(screen.getByText('Not opened yet')).toBeTruthy();
});

it('shows opens beside the date and in the expanded details', () => {
  const last = '2026-10-21T16:40:00Z';
  renderTopBar({
    openCount: 1,
    firstOpenedAt: last,
    lastOpenedAt: last,
  });
  expect(screen.getByText('Opened')).toBeTruthy();
  expect(screen.getByText(`Opened ${formatShortDateTime(last)}`)).toBeTruthy();
});
