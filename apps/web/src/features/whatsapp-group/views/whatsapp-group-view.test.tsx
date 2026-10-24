import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@solidjs/testing-library';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { WhatsAppGroupProvider } from '../context/whatsapp-group-context';
import { createFakeGroup, group, messages } from '../tests/fake-capabilities';
import { WhatsAppGroupView } from './whatsapp-group-view';

beforeEach(() => {
  vi.stubGlobal('scrollTo', vi.fn());
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe = vi.fn();
      unobserve = vi.fn();
      disconnect = vi.fn();
    }
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
function mount(fake: ReturnType<typeof createFakeGroup>) {
  const share = vi.fn();
  render(() => (
    <WhatsAppGroupProvider value={fake.capabilities}>
      <WhatsAppGroupView
        userId={group.ownerId}
        onShare={share}
        onConnect={vi.fn()}
        renderAttachment={(id) => <span>document {id}</span>}
      />
    </WhatsAppGroupProvider>
  ));
  return { share };
}
it('shows external names, quotes, reactions and the viewers own sending identity', async () => {
  const fake = createFakeGroup();
  const { share } = mount(fake);
  expect(screen.getByText('Ana Ruiz')).toBeTruthy();
  expect(screen.getByText('Sending as +14155550142')).toBeTruthy();
  expect(
    screen.getByRole('button', { name: '👍 2, your reaction' })
  ).toBeTruthy();
  expect(screen.getByText(/Ana Ruiz: The updated designs/)).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Share' }));
  expect(share).toHaveBeenCalledOnce();
  fireEvent.click(screen.getAllByRole('button', { name: 'Reply' })[0]);
  fireEvent.input(
    screen.getByRole('textbox', { name: 'Message WhatsApp group' }),
    { target: { value: 'My own account reply' } }
  );
  fireEvent.click(screen.getByRole('button', { name: 'Send' }));
  await waitFor(() =>
    expect(fake.capabilities.send).toHaveBeenCalledWith(
      { kind: 'text', text: 'My own account reply', replyTo: 'message-1' },
      expect.any(String)
    )
  );
});
it('lets a shared viewer without WhatsApp read the timeline and asks them to connect to reply', () => {
  const fake = createFakeGroup({
    group: {
      ...group,
      accessLevel: 'view',
      canSend: false,
      sendReason: 'no_account',
    },
  });
  mount(fake);
  expect(
    screen.getByText('The updated designs are ready for review.')
  ).toBeTruthy();
  expect(screen.getByText('Connect your WhatsApp to reply')).toBeTruthy();
  expect(screen.queryByRole('textbox')).toBeNull();
  expect(screen.queryByRole('button', { name: 'Edit' })).toBeNull();
  expect(fake.capabilities.send).not.toHaveBeenCalled();
});
it('keeps unknown sends visible without any automatic resend', () => {
  const fake = createFakeGroup({
    sends: [
      { id: 'send-1', preview: 'Running 10 minutes late', state: 'unknown' },
    ],
    messages: [
      {
        ...messages[0],
        attachments: [
          {
            ordinal: 0,
            state: 'loading',
            fileName: 'design.pdf',
            documentId: undefined,
          },
        ],
      },
    ],
  });
  mount(fake);
  expect(screen.getByText(/may already have arrived/)).toBeTruthy();
  expect(screen.getByText('Loading design.pdf…')).toBeTruthy();
  expect(fake.capabilities.send).not.toHaveBeenCalled();
});
it('offers edit and delete only for own messages, and confirms deletion', async () => {
  const fake = createFakeGroup();
  mount(fake);
  expect(screen.getAllByRole('button', { name: 'Edit' })).toHaveLength(1);
  fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
  expect(screen.queryByLabelText('Attach file')).toBeNull();
  expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe(
    'Looking now. Thanks, Ana!'
  );
  fireEvent.input(screen.getByRole('textbox'), {
    target: { value: 'Edited from my account' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Send' }));
  await waitFor(() =>
    expect(fake.capabilities.send).toHaveBeenCalledWith(
      { kind: 'edit', messageId: 'message-2', text: 'Edited from my account' },
      expect.any(String)
    )
  );
  fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
  expect(fake.capabilities.send).toHaveBeenCalledTimes(1);
  const confirmation = screen.getAllByRole('button', { name: 'Delete' }).at(-1);
  if (!confirmation) throw new Error('Missing delete confirmation');
  fireEvent.click(confirmation);
  await waitFor(() =>
    expect(fake.capabilities.send).toHaveBeenCalledWith(
      { kind: 'delete', messageId: 'message-2' },
      expect.any(String)
    )
  );
});
