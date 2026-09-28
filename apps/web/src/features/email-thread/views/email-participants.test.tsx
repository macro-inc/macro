import { render } from '@solidjs/testing-library';
import { createSignal, type ParentProps } from 'solid-js';
import { expect, it, vi } from 'vitest';
import { createComposeContext } from '../../email-compose/tests/capabilities';
import { EmailThreadStateProvider } from '../context/email-thread-state-context';
import { EmailThreadViewProvider } from '../context/email-thread-view-context';
import { createEmailThreadState } from '../primitives/email-thread-state';
import { createThreadContext, message, thread } from '../tests/fixtures';
import { EmailParticipants } from './email-participants';

vi.mock('@core/component/UserIcon', () => ({ UserIcon: () => <span /> }));
vi.mock('@app/features/email-message/components/email-user-tooltip', () => ({
  EmailUserTooltip: (props: ParentProps) => <>{props.children}</>,
}));

it('keeps participant order and nodes through draft creation, deletion and refetches', () => {
  const sent = message('sent', {
    from: { email: 'sender@example.com', name: 'Sender' },
    to: [{ email: 'viewer@example.com' }],
  });
  const draft = message('draft', {
    is_draft: true,
    replying_to_id: sent.db_id,
    from: { email: 'viewer@example.com' },
    to: [{ email: 'new@example.com', name: 'Unsent' }],
  });
  const [messages, setMessages] = createSignal([sent]);
  const view = render(() => {
    const context = createThreadContext({ thread: () => thread(messages()) });
    const state = createEmailThreadState(context);
    return (
      <EmailThreadViewProvider
        value={{
          thread: context,
          compose: createComposeContext(),
          rendering: {},
        }}
      >
        <EmailThreadStateProvider value={state}>
          <EmailParticipants />
        </EmailThreadStateProvider>
      </EmailThreadViewProvider>
    );
  });
  try {
    const original = view.getAllByRole('listitem');
    expect(original.map((node) => node.textContent)).toEqual(['Sender', 'Me']);
    for (const snapshot of [
      [draft, sent],
      [sent],
      [draft, sent],
      [sent, draft],
    ]) {
      setMessages(structuredClone(snapshot));
      const current = view.getAllByRole('listitem');
      expect(current.map((node) => node.textContent)).toEqual(['Sender', 'Me']);
      current.forEach((node, index) => expect(node).toBe(original[index]));
    }
    // Stable keys must still propagate changed contact details.
    setMessages([{ ...sent, from: { ...sent.from!, name: 'Updated' } }]);
    expect(view.getAllByRole('listitem')[0]).toBe(original[0]);
    expect(original[0].textContent).toBe('Updated');
  } finally {
    view.unmount();
  }
});
