/** @vitest-environment jsdom */
import { cleanup, render, screen } from '@solidjs/testing-library';
import { afterEach, expect, it } from 'vitest';
import { Root } from '../Root';
import { ExternalBadge } from '../SenderName';

afterEach(cleanup);

it('distinguishes external attribution from an internal teammate with the same display name', () => {
  const message = {
    id: 'message',
    content: 'Hello',
    sender_id: 'external|01900000-0000-7000-8000-000000000001',
    imported_author: { name: 'Maya' },
    created_at: '',
    updated_at: '',
    attachments: [],
    reactions: [],
  };
  render(() => (
    <Root message={message}>
      <ExternalBadge />
    </Root>
  ));
  expect(screen.getByText('External')).toBeTruthy();
  cleanup();
  render(() => (
    <Root message={{ ...message, sender_id: 'macro|maya@example.test' }}>
      <ExternalBadge />
    </Root>
  ));
  expect(screen.queryByText('External')).toBeNull();
});
