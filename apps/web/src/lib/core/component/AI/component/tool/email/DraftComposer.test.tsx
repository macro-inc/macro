import { useCompose } from '@app/features/email-compose/context/compose-context';
import type { SendEmail } from '@service-cognition/generated/tools/types';
import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { createEditor } from 'lexical';
import { type Accessor, createSignal, type JSX, onMount } from 'solid-js';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  reply: (): {
    isPending: boolean;
    isFetching: boolean;
    isError: boolean;
    data: string | undefined;
  } => ({ isPending: true, isFetching: true, isError: false, data: undefined }),
  links: (): {
    id: string;
    email_address: string;
    settings: { signature_on_replies_forwards: boolean };
  }[] => [],
  linksPending: false,
  retry: vi.fn(),
  execute: vi.fn(),
  edit: vi.fn(),
}));

vi.mock('@queries/email/link', () => ({
  useEmailLinksQuery: () => ({
    get isPending() {
      return mocks.linksPending;
    },
    isError: false,
    get data() {
      return { links: mocks.links() };
    },
  }),
  findPrimaryEmailLinkId: () => 'primary',
  useMessageInboxQuery: () => ({
    get isPending() {
      return mocks.reply().isPending;
    },
    get isFetching() {
      return mocks.reply().isFetching;
    },
    get isError() {
      return mocks.reply().isError;
    },
    get data() {
      return mocks.reply().data;
    },
    refetch: mocks.retry,
  }),
  useEmailSignature: (id: Accessor<string | undefined>) => () =>
    id() ? `Signature for ${id()}` : undefined,
}));
vi.mock('@core/context/user', () => ({ useUserId: () => () => 'macro|self' }));
vi.mock('@app/lib/analytics/posthog', () => ({
  useFeatureFlag: () => () => ({ enabled: true }),
}));
vi.mock('@core/component/Toast/Toast', () => ({ toast: { failure: vi.fn() } }));
vi.mock('@core/mobile/isMobile', () => ({ isMobile: () => false }));
vi.mock('@core/mobile/isTouchDevice', () => ({ isTouchDevice: () => false }));
vi.mock('@core/util/interceptMailtoLinks', () => ({
  interceptMailtoLinks: vi.fn(),
}));
vi.mock('@core/util/upload', () => ({
  forceDssRuleset: {},
  uploadFile: vi.fn(),
}));
vi.mock('@queries/storage/document-metadata', () => ({
  fetchDocumentMetadata: vi.fn(),
}));
vi.mock('@tanstack/solid-query', () => ({ useQueryClient: () => ({}) }));
vi.mock('@ui', () => ({
  ComposerSurface: () => null,
  cn: () => '',
  confirmDialog: vi.fn(async () => false),
  Button: (props: JSX.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button {...props} />
  ),
}));
vi.mock('@app/features/email-compose/editor-adapter', () => ({
  createComposeBodyActions: () => ({}),
}));
vi.mock('@app/features/email-compose/make-attachment-public', () => ({
  makeAttachmentPublic: vi.fn(),
}));
vi.mock('@app/features/email-compose/upload-documents', () => ({
  uploadAttachmentDocuments: vi.fn(async () => []),
}));
vi.mock('@app/features/email-compose/components/signature-preview', () => ({
  SignaturePreview: (props: { html: string }) => (
    <span aria-label="Signature">{props.html}</span>
  ),
}));
vi.mock('@app/features/email-compose/views/compose-toolbar', () => ({
  EmailComposeToolbar: () => null,
}));
vi.mock('@app/features/email-compose/primitives/prepare-email-body', () => ({
  prepareEmailBody: () => ({ bodyHtml: 'Reply body', bodyText: 'Reply body' }),
}));
vi.mock('@app/features/email-compose/views/compose-layout', () => ({
  ComposeLayout: (props: { notice?: JSX.Element }) => {
    const compose = useCompose();
    onMount(() => compose.onEditorInitialized?.(createEditor()));
    return (
      <>
        {props.notice}
        <span aria-label="From">{compose.fromAddress?.()}</span>
        {compose.signaturePreview?.()}
        <button onClick={() => compose.onSelectInbox?.('secondary')}>
          Choose secondary
        </button>
        <button onClick={() => compose.setSubject('Edited reply')}>
          Edit subject
        </button>
        <button
          disabled={compose.primaryActionDisabled()}
          onClick={() => compose.onSend()}
        >
          Send
        </button>
        <button onClick={() => compose.onSend()}>Keyboard send</button>
      </>
    );
  },
}));

import {
  EmailDraftComposer,
  type EmailDraftComposerProps,
} from './DraftComposer';

function showDraft(
  from?: string,
  replyingToId: string | null = 'received-in-secondary',
  registerSubmitReader?: EmailDraftComposerProps['registerSubmitReader']
) {
  const draft: SendEmail = {
    to: [{ email: 'recipient@example.com' }],
    subject: 'Reply',
    body: 'Reply body',
    replyingToId,
    from,
  };
  render(() => (
    <EmailDraftComposer
      initialData={draft}
      debugName="sending-inbox-test"
      registerSubmitReader={registerSubmitReader}
      sink={{
        canAct: () => true,
        lockedNotice: () => undefined,
        onExecute: mocks.execute,
        onEdit: mocks.edit,
        onReject: async () => true,
      }}
    />
  ));
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.reply = () => ({
    isPending: true,
    isFetching: true,
    isError: false,
    data: undefined,
  });
  mocks.linksPending = false;
  mocks.links = () => [
    {
      id: 'primary',
      email_address: 'primary@example.com',
      settings: { signature_on_replies_forwards: true },
    },
    {
      id: 'secondary',
      email_address: 'secondary@example.com',
      settings: { signature_on_replies_forwards: true },
    },
  ];
  mocks.execute.mockResolvedValue(true);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

it.each([undefined, '   '])(
  'waits for the reply sender without showing a guessed address or signature (from: %j)',
  async (from) => {
    showDraft(from);
    expect(screen.getByLabelText('From').textContent).toBe('');
    expect(screen.queryByLabelText('Signature')).toBeNull();
    expect(screen.getByRole('status').textContent).toContain(
      'Resolving sender'
    );
    expect(screen.getByText('Send')).toHaveProperty('disabled', true);
    await fireEvent.click(screen.getByText('Send'));
    await fireEvent.click(screen.getByText('Keyboard send'));
    expect(mocks.execute).not.toHaveBeenCalled();
  }
);

it('does not persist the fallback sender when editing before the reply inbox resolves', async () => {
  vi.useFakeTimers();
  showDraft();
  await fireEvent.click(screen.getByText('Edit subject'));
  vi.runAllTimers();
  expect(mocks.edit).toHaveBeenCalledWith(
    expect.objectContaining({ subject: 'Edited reply', from: undefined })
  );
});

it('leaves a resolved implicit reply sender to the backend', async () => {
  mocks.reply = () => ({
    isPending: false,
    isFetching: false,
    isError: false,
    data: 'secondary',
  });
  showDraft();
  expect(screen.getByLabelText('From').textContent).toBe(
    'secondary@example.com'
  );
  await fireEvent.click(screen.getByText('Send'));
  expect(mocks.execute).toHaveBeenCalledWith(
    expect.objectContaining({ from: undefined })
  );
});

it('preserves an unavailable explicit sender on edits and blocks delivery until replaced', async () => {
  vi.useFakeTimers();
  showDraft('disconnected@example.com');
  expect(screen.getByRole('status').textContent).toContain(
    'disconnected@example.com is unavailable'
  );
  expect(screen.queryByLabelText('Signature')).toBeNull();
  expect(screen.getByText('Send')).toHaveProperty('disabled', true);
  await fireEvent.click(screen.getByText('Keyboard send'));
  expect(mocks.execute).not.toHaveBeenCalled();
  await fireEvent.click(screen.getByText('Edit subject'));
  vi.runAllTimers();
  expect(mocks.edit).toHaveBeenCalledWith(
    expect.objectContaining({ from: 'disconnected@example.com' })
  );
  await fireEvent.click(screen.getByText('Choose secondary'));
  expect(screen.queryByRole('status')).toBeNull();
  expect(screen.getByText('Send')).toHaveProperty('disabled', false);
  await fireEvent.click(screen.getByText('Send'));
  expect(mocks.execute).toHaveBeenCalledWith(
    expect.objectContaining({ from: 'secondary@example.com' })
  );
});

it('recovers from a failed reply lookup through Retry', async () => {
  const [reply, setReply] = createSignal({
    isPending: false,
    isFetching: false,
    isError: true,
    data: undefined as string | undefined,
  });
  mocks.reply = reply;
  mocks.retry.mockImplementation(() =>
    setReply({
      isPending: false,
      isFetching: false,
      isError: false,
      data: 'secondary',
    })
  );
  showDraft();
  expect(screen.getByRole('status').textContent).toContain(
    'Could not resolve the reply sender'
  );
  expect(screen.getByText('Send')).toHaveProperty('disabled', true);
  expect(screen.queryByLabelText('Signature')).toBeNull();
  await fireEvent.click(screen.getByText('Retry'));
  expect(mocks.retry).toHaveBeenCalledOnce();
  expect(screen.queryByRole('status')).toBeNull();
  expect(screen.getByLabelText('From').textContent).toBe(
    'secondary@example.com'
  );
  expect(screen.getByLabelText('Signature').textContent).toBe(
    'Signature for secondary'
  );
  await fireEvent.click(screen.getByText('Send'));
  expect(mocks.execute).toHaveBeenCalledWith(
    expect.objectContaining({ from: undefined })
  );
});

it('keeps a manual choice when a late reply lookup resolves to another inbox', async () => {
  const [reply, setReply] = createSignal(mocks.reply());
  mocks.reply = reply;
  showDraft();
  await fireEvent.click(screen.getByText('Choose secondary'));
  setReply({
    isPending: false,
    isFetching: false,
    isError: false,
    data: 'primary',
  });
  expect(screen.getByLabelText('From').textContent).toBe(
    'secondary@example.com'
  );
  expect(screen.getByLabelText('Signature').textContent).toBe(
    'Signature for secondary'
  );
  await fireEvent.click(screen.getByText('Send'));
  expect(mocks.execute).toHaveBeenCalledWith(
    expect.objectContaining({ from: 'secondary@example.com' })
  );
});

it('preserves a selected sender after its inbox is disconnected', async () => {
  vi.useFakeTimers();
  const [links, setLinks] = createSignal(mocks.links());
  mocks.links = links;
  showDraft();
  await fireEvent.click(screen.getByText('Choose secondary'));
  setLinks(links().filter((link) => link.id === 'primary'));
  expect(screen.getByRole('status').textContent).toContain(
    'secondary@example.com is unavailable'
  );
  expect(screen.getByText('Send')).toHaveProperty('disabled', true);
  await fireEvent.click(screen.getByText('Keyboard send'));
  expect(mocks.execute).not.toHaveBeenCalled();
  await fireEvent.click(screen.getByText('Edit subject'));
  vi.runAllTimers();
  expect(mocks.edit).toHaveBeenCalledWith(
    expect.objectContaining({ from: 'secondary@example.com' })
  );
});

it('defaults a new email to the primary inbox', async () => {
  showDraft(undefined, null);
  expect(screen.getByLabelText('From').textContent).toBe('primary@example.com');
  expect(screen.getByText('Send')).toHaveProperty('disabled', false);
  await fireEvent.click(screen.getByText('Send'));
  expect(mocks.execute).toHaveBeenCalledWith(
    expect.objectContaining({ from: undefined })
  );
});

it.each([undefined, 'disconnected@example.com'])(
  'blocks batch submission until a sender is resolved (from: %j)',
  async (from) => {
    const register =
      vi.fn<NonNullable<EmailDraftComposerProps['registerSubmitReader']>>();
    showDraft(from, 'received-in-secondary', register);
    const read = register.mock.calls[0][0];
    expect(await read()).toBeUndefined();
    await fireEvent.click(screen.getByText('Choose secondary'));
    expect(await read()).toEqual(
      expect.objectContaining({ from: 'secondary@example.com' })
    );
  }
);

it('does not discard an explicit address while the inbox list is loading', async () => {
  vi.useFakeTimers();
  mocks.linksPending = true;
  showDraft('secondary@example.com');
  expect(screen.getByText('Send')).toHaveProperty('disabled', true);
  expect(screen.queryByLabelText('Signature')).toBeNull();
  await fireEvent.click(screen.getByText('Edit subject'));
  vi.runAllTimers();
  expect(mocks.edit).toHaveBeenCalledWith(
    expect.objectContaining({ from: 'secondary@example.com' })
  );
});

it('preserves the sender named in the draft', async () => {
  showDraft('secondary@example.com');
  await fireEvent.click(screen.getByText('Send'));
  expect(mocks.execute).toHaveBeenCalledWith(
    expect.objectContaining({ from: 'secondary@example.com' })
  );
});

it.each([undefined, 'primary@example.com'])(
  'sends from the user-selected inbox before the reply inbox resolves (draft sender: %j)',
  async (from) => {
    showDraft(from);
    await fireEvent.click(screen.getByText('Choose secondary'));
    expect(screen.getByLabelText('From').textContent).toBe(
      'secondary@example.com'
    );
    await fireEvent.click(screen.getByText('Send'));
    expect(mocks.execute).toHaveBeenCalledWith(
      expect.objectContaining({ from: 'secondary@example.com' })
    );
  }
);
