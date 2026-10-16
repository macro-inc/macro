import { createSignal } from 'solid-js';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { message } from '../../email-message/tests/messages';
import { createComposeContext } from '../tests/capabilities';
import { mountReplyComposer } from '../tests/reply';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

it('waits for sender discovery even when the thread inbox ID is already known', async () => {
  const [loaded, setLoaded] = createSignal(false);
  const context = createComposeContext();
  context.accounts.loading = () => !loaded();
  context.accounts.inboxes = () =>
    loaded()
      ? [
          {
            id: 'inbox',
            email_address: 'me@example.com',
            settings: {},
            sendAs: [{ email_address: 'resident@example.com' }],
          },
        ]
      : [];
  const parent = message('parent', {
    link_id: 'inbox',
    from: { email: 'customer@example.com' },
    to: [{ email: 'resident@example.com' }],
  });
  const composer = mountReplyComposer(context, () => parent);
  try {
    await composer.sendEmail();
    expect(context.delivery.sendMessage).not.toHaveBeenCalled();
    expect(context.notices.feedback.alert).toHaveBeenCalledWith(
      'Loading email sender addresses...'
    );
    setLoaded(true);
    await composer.sendEmail();
    expect(context.delivery.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        inboxId: 'inbox',
        message: expect.objectContaining({
          sender_email: 'resident@example.com',
        }),
      })
    );
  } finally {
    composer.dispose();
  }
});
