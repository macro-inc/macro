/** @vitest-environment jsdom */

import type { MetaConversationView } from '@service-storage/generated/schemas/metaConversationView';
import type { MetaSendProgress } from '@service-storage/generated/schemas/metaSendProgress';
import type { MetaTemplate } from '@service-storage/generated/schemas/metaTemplate';
import type { MetaUploadedAttachment } from '@service-storage/generated/schemas/metaUploadedAttachment';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ConversationAccount } from '../core/conversation';
import { createReplySource } from '../queries/reply-source';
import { replyOptions } from '../tests/reply-options';
import { ChannelMessagingComposer } from './channel-composer';

const fixture = vi.hoisted(() => ({
  account: undefined as MetaConversationView | undefined,
  reply: vi.fn(),
  isError: false,
  touch: false,
  userId: (): string => 'macro|owner@fixture.test',
  templates: [] as MetaTemplate[],
  templatesReady: (): boolean => true,
  upload: vi.fn(),
  selectFiles: undefined as ((files: File[]) => Promise<void>) | undefined,
  recover: undefined as ((send: MetaSendProgress) => void) | undefined,
}));
vi.mock('@core/context/user', () => ({
  useUserId: () => () => fixture.userId(),
}));
vi.mock('@core/mobile/isTouchDevice', () => ({
  isTouchDevice: () => fixture.touch,
}));
vi.mock('@core/util/upload', () => ({
  openFilePicker: (_: unknown, onSelect: (files: File[]) => Promise<void>) => {
    fixture.selectFiles = onSelect;
    return () => {};
  },
}));
vi.mock('@queries/meta-messaging', () => ({
  useMetaConversation: () => ({
    get data() {
      return fixture.account;
    },
  }),
  useMetaReply: () => ({ mutateAsync: fixture.reply, isPending: false }),
  useMetaTemplates: () => ({
    get isSuccess() {
      return fixture.templatesReady();
    },
    isError: false,
    get data() {
      return fixture.templates;
    },
    refetch: vi.fn(),
  }),
  useMetaUpload: () => ({ isPending: false, mutateAsync: fixture.upload }),
}));
function account(
  provider: 'whatsapp' | 'instagram' = 'whatsapp'
): MetaConversationView {
  return {
    ...replyOptions(provider),
    can_reply: true,
    text_limit: provider === 'whatsapp' ? 4096 : 1000,
    text_limit_in_bytes: provider === 'instagram',
    media: [],
    provider,
    account_name: 'Fixture business',
    status: 'connected',
    developer_account: false,
    human_agent_approved: false,
    sends: [],
    conversation: {
      channel_id: 'channel-one',
      connection_id: 'account-one',
      customer_id: 'customer-one',
      customer_display_name: 'Customer One',
      last_customer_message_at: new Date().toISOString(),
    },
  };
}
function mount(channel: () => string = () => 'channel-one') {
  render(() => (
    <ChannelMessagingComposer
      channelId={channel()}
      userId={fixture.userId()}
      createSource={createReplySource}
      interaction={
        fixture.account
          ? {
              kind: 'external',
              account: fixture.account,
              available: !fixture.isError,
            }
          : fixture.isError
            ? { kind: 'error' }
            : { kind: 'internal' }
      }
      onRefresh={() => {}}
      onRecoverReady={(recover) => {
        fixture.recover = recover;
        return () => {
          fixture.recover = undefined;
        };
      }}
    />
  ));
}
beforeEach(() => {
  localStorage.clear();
  fixture.account = account();
  fixture.reply.mockReset().mockResolvedValue({});
  fixture.isError = false;
  fixture.touch = false;
  fixture.userId = () => 'macro|owner@fixture.test';
  fixture.templates = [];
  fixture.templatesReady = () => true;
  fixture.upload.mockReset();
  fixture.selectFiles = undefined;
});
afterEach(cleanup);

function failedReply(
  message: MetaSendProgress['payload']['message']
): MetaSendProgress {
  return {
    id: 'failed-draft',
    channel_id: 'channel-one',
    user_id: 'macro|owner@fixture.test',
    state: 'failed',
    created_at: new Date().toISOString(),
    payload: { idempotency_key: 'old-intent', message },
  };
}

function enableImages() {
  fixture.account!.capabilities.media = [
    {
      kind: 'image',
      caption_limit: 1024,
      max_bytes: 100000,
      mime_types: ['image/png'],
    },
  ];
}

describe('native external-reply boundary', () => {
  it('keeps personal-account permission denials separate from Business reply windows', async () => {
    const [personal, setPersonal] = createSignal<ConversationAccount>({
      ...account(),
      transport: 'linked',
      authorization_generation: 1,
      eligibility: {
        evaluated_at: new Date().toISOString(),
        modes: [{ mode: 'free_form', allowed: false, reason: 'forbidden' }],
      },
    });
    render(() => (
      <ChannelMessagingComposer
        channelId="personal-group"
        channelName="Project group"
        userId={fixture.userId()}
        createSource={createReplySource}
        interaction={{ kind: 'external', account: personal(), available: true }}
        onRefresh={() =>
          setPersonal({
            ...personal(),
            eligibility: {
              evaluated_at: new Date().toISOString(),
              modes: [{ mode: 'free_form', allowed: true }],
            },
          })
        }
        onRecoverReady={() => () => {}}
      />
    ));
    fireEvent.input(screen.getByRole('textbox'), {
      target: { value: 'A personal reply' },
    });
    const send = screen.getByRole('button', {
      name: 'Send reply via WhatsApp',
    });
    expect(send).toHaveProperty('disabled', true);
    expect(
      screen.getByText('Sending is unavailable for this group.')
    ).toBeTruthy();
    expect(
      screen.queryByText(/reply window|approved template|human-authored reply/i)
    ).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    await waitFor(() => expect(send).toHaveProperty('disabled', false));
    fireEvent.click(send);
    await waitFor(() => expect(fixture.reply).toHaveBeenCalledOnce());
  });
  it('returns focus to the reply field after sending from the button', async () => {
    mount();
    const input = screen.getByRole('textbox', {
      name: 'External customer reply',
    });
    fireEvent.input(input, { target: { value: 'Continue the conversation' } });
    const button = screen.getByRole('button', {
      name: 'Send reply via WhatsApp',
    });
    button.focus();
    fireEvent.click(button);
    await waitFor(() => expect(document.activeElement).toBe(input));
    expect(input).toHaveProperty('value', '');
  });
  it('sends with Enter while Shift+Enter and IME composition keep the draft', async () => {
    mount();
    const input = screen.getByRole('textbox', {
      name: 'External customer reply',
    });
    fireEvent.input(input, { target: { value: 'Shortcut reply' } });
    fireEvent.keyDown(input, { key: 'Enter', shiftKey: true });
    fireEvent.keyDown(input, { key: 'Enter', isComposing: true });
    expect(fixture.reply).not.toHaveBeenCalled();
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(fixture.reply).toHaveBeenCalledOnce());
  });
  it('does not expose one signed-in user’s draft to another user in the same channel', () => {
    const [user, setUser] = createSignal('macro|owner@fixture.test');
    fixture.userId = user;
    mount();
    fireEvent.input(screen.getByRole('textbox'), {
      target: { value: 'Private owner draft' },
    });
    setUser('macro|teammate@fixture.test');
    expect(screen.getByRole('textbox')).toHaveProperty('value', '');
    fireEvent.input(screen.getByRole('textbox'), {
      target: { value: 'Teammate draft' },
    });
    setUser('macro|owner@fixture.test');
    expect(screen.getByRole('textbox')).toHaveProperty(
      'value',
      'Private owner draft'
    );
    expect(fixture.reply).not.toHaveBeenCalled();
  });
  it('reuses the intent key after a network error', async () => {
    fixture.reply.mockRejectedValueOnce(new Error('Network interrupted'));
    mount();
    fireEvent.input(
      screen.getByRole('textbox', { name: 'External customer reply' }),
      { target: { value: 'Deliberate reply' } }
    );
    fireEvent.click(
      screen.getByRole('button', { name: 'Send reply via WhatsApp' })
    );
    await screen.findByRole('alert');
    cleanup();
    mount();
    expect(screen.getByRole('textbox')).toHaveProperty('value', '');
    fireEvent.click(
      screen.getByRole('button', { name: 'Retry previous reply' })
    );
    await waitFor(() => expect(fixture.reply).toHaveBeenCalledTimes(2));
    expect(fixture.reply.mock.calls[1][0].idempotency_key).toBe(
      fixture.reply.mock.calls[0][0].idempotency_key
    );
    cleanup();
    mount();
    expect(screen.getByRole('textbox')).toHaveProperty('value', '');
  });
  it('restores a staged attachment and caption after remount', async () => {
    enableImages();
    mount();
    fixture.recover!(
      failedReply({
        type: 'media',
        kind: 'image',
        document_id: 'private-file',
        caption: 'Saved caption',
      })
    );
    cleanup();
    mount();
    expect(screen.getByText('Previously attached file')).toBeTruthy();
    expect(screen.getByRole('textbox')).toHaveProperty(
      'value',
      'Saved caption'
    );
    fireEvent.click(
      screen.getByRole('button', { name: 'Send reply via WhatsApp' })
    );
    await waitFor(() => expect(fixture.reply).toHaveBeenCalledOnce());
    expect(fixture.reply.mock.calls[0][0].message).toEqual({
      type: 'media',
      kind: 'image',
      document_id: 'private-file',
      caption: 'Saved caption',
    });
  });
  it('does not offer templates the server does not currently allow', () => {
    fixture.account!.eligibility.modes = [
      { mode: 'free_form', allowed: false, reason: 'template_required' },
      { mode: 'approved_template', allowed: false, reason: 'forbidden' },
    ];
    mount();
    expect(
      screen.queryByRole('button', { name: 'Choose template' })
    ).toBeNull();
    expect(screen.getByText(/Wait for a new customer message/)).toBeTruthy();
  });
  it('preserves an Instagram human-support draft through remount', () => {
    fixture.account = account('instagram');
    fixture.account.eligibility.modes = [
      { mode: 'free_form', allowed: false, reason: 'window_closed' },
      {
        mode: 'human_support',
        allowed: true,
        expires_at: new Date(Date.now() + 3600000).toISOString(),
      },
    ];
    mount();
    fireEvent.input(screen.getByRole('textbox'), {
      target: { value: 'Support follow-up' },
    });
    fireEvent.click(screen.getByRole('checkbox'));
    cleanup();
    mount();
    expect(screen.getByRole('textbox')).toHaveProperty(
      'value',
      'Support follow-up'
    );
    expect(screen.getByRole('checkbox')).toHaveProperty('checked', true);
    expect(
      screen.getByRole('button', { name: 'Send reply via Instagram' })
    ).toHaveProperty('disabled', false);
  });
  it('does not send a hidden human-support choice after the window reopens', async () => {
    fixture.account = account('instagram');
    fixture.account.eligibility.modes = [
      { mode: 'free_form', allowed: false, reason: 'window_closed' },
      { mode: 'human_support', allowed: true },
    ];
    mount();
    fireEvent.input(screen.getByRole('textbox'), {
      target: { value: 'Support follow-up' },
    });
    fireEvent.click(screen.getByRole('checkbox'));
    cleanup();
    fixture.account = account('instagram');
    mount();
    expect(screen.queryByRole('checkbox')).toBeNull();
    fireEvent.click(
      screen.getByRole('button', { name: 'Send reply via Instagram' })
    );
    await waitFor(() => expect(fixture.reply).toHaveBeenCalledOnce());
    expect(fixture.reply.mock.calls[0][0].human_support).toBe(false);
  });
  it('ignores a late send completion after returning and writing a newer draft', async () => {
    let resolveReply!: (value: unknown) => void;
    fixture.reply.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveReply = resolve;
        })
    );
    const [channel, setChannel] = createSignal('channel-one');
    mount(channel);
    fireEvent.input(screen.getByRole('textbox'), {
      target: { value: 'In-flight reply' },
    });
    fireEvent.click(
      screen.getByRole('button', { name: 'Send reply via WhatsApp' })
    );
    setChannel('channel-two');
    setChannel('channel-one');
    fireEvent.input(screen.getByRole('textbox'), {
      target: { value: 'Newer draft' },
    });
    resolveReply({});
    await Promise.resolve();
    expect(screen.getByRole('textbox')).toHaveProperty('value', 'Newer draft');
    cleanup();
    mount();
    expect(screen.getByRole('textbox')).toHaveProperty('value', 'Newer draft');
  });
  it('ignores an old upload after navigation and a newer attachment selection', async () => {
    enableImages();
    let resolveUpload!: (file: MetaUploadedAttachment) => void;
    fixture.upload.mockImplementationOnce(
      () =>
        new Promise<MetaUploadedAttachment>((resolve) => {
          resolveUpload = resolve;
        })
    );
    const [channel, setChannel] = createSignal('channel-one');
    mount(channel);
    const image = new File(['fixture'], 'photo.png', { type: 'image/png' });
    fireEvent.click(screen.getByRole('button', { name: 'Attach file' }));
    const oldUpload = fixture.selectFiles!([image]);
    setChannel('channel-two');
    setChannel('channel-one');
    fixture.upload.mockResolvedValueOnce({
      document_id: 'new-file',
      filename: 'new.png',
      kind: 'image',
    });
    fireEvent.click(screen.getByRole('button', { name: 'Attach file' }));
    await fixture.selectFiles!([image]);
    resolveUpload({
      document_id: 'old-file',
      filename: 'old.png',
      kind: 'image',
    });
    await oldUpload;
    expect(screen.getByText('new.png')).toBeTruthy();
    expect(screen.queryByText('old.png')).toBeNull();
    cleanup();
    mount();
    expect(screen.getByText('new.png')).toBeTruthy();
  });
  it('requires checking the original app before resending an uncertain outcome', async () => {
    fixture.account!.sends = [
      {
        id: 'intent',
        channel_id: 'channel-one',
        user_id: 'macro|owner@fixture.test',
        state: 'unknown',
        created_at: new Date().toISOString(),
        payload: {
          idempotency_key: 'old-key',
          message: { type: 'text', text: 'Possibly delivered' },
          human_support: false,
        },
      },
    ];
    mount();
    fixture.recover!(fixture.account!.sends[0]);
    const send = screen.getByRole('button', {
      name: 'Send reply via WhatsApp',
    });
    expect(send).toHaveProperty('disabled', true);
    expect(fixture.reply).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('checkbox'));
    expect(send).toHaveProperty('disabled', false);
    cleanup();
    mount();
    const reopenedSend = screen.getByRole('button', {
      name: 'Send reply via WhatsApp',
    });
    expect(screen.getByRole('textbox')).toHaveProperty(
      'value',
      'Possibly delivered'
    );
    expect(screen.getByRole('checkbox')).toHaveProperty('checked', false);
    expect(reopenedSend).toHaveProperty('disabled', true);
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(reopenedSend);
    await waitFor(() => expect(fixture.reply).toHaveBeenCalledOnce());
    expect(fixture.reply.mock.calls[0][0].idempotency_key).not.toBe('old-key');
  });
  it('enforces Instagram byte limits and disables sends when server status is unavailable', () => {
    fixture.account = account('instagram');
    mount();
    fireEvent.input(
      screen.getByRole('textbox', { name: 'External customer reply' }),
      { target: { value: 'é'.repeat(501) } }
    );
    expect(
      screen.getByRole('button', { name: 'Send reply via Instagram' })
    ).toHaveProperty('disabled', true);
    cleanup();
    fixture.isError = true;
    mount();
    fireEvent.input(
      screen.getByRole('textbox', { name: 'External customer reply' }),
      { target: { value: 'Preserved draft' } }
    );
    expect(
      screen.getByRole('button', { name: 'Send reply via Instagram' })
    ).toHaveProperty('disabled', true);
    expect(fixture.reply).not.toHaveBeenCalled();
  });
  it('restores from the message row, opens customer reply, and protects an existing draft', () => {
    mount();
    const failed: MetaSendProgress = {
      id: 'failed',
      channel_id: 'channel-one',
      user_id: 'macro|owner@fixture.test',
      state: 'failed',
      created_at: new Date().toISOString(),
      payload: {
        idempotency_key: 'failed-key',
        message: { type: 'text', text: 'Saved reply' },
      },
    };
    fixture.recover!(failed);
    expect(
      screen.getByRole('textbox', { name: 'External customer reply' })
    ).toHaveProperty('value', 'Saved reply');
    fixture.recover!({
      ...failed,
      payload: {
        ...failed.payload,
        message: { type: 'text', text: 'Another reply' },
      },
    });
    expect(
      screen.getByRole('textbox', { name: 'External customer reply' })
    ).toHaveProperty('value', 'Saved reply');
    expect(screen.getByRole('alert').textContent).toContain('current draft');
    expect(fixture.reply).not.toHaveBeenCalled();
  });
  it('does not display raw server errors or a delivery history inside the composer', async () => {
    fixture.reply.mockRejectedValueOnce(new Error('configuration_required'));
    mount();
    fireEvent.input(
      screen.getByRole('textbox', { name: 'External customer reply' }),
      { target: { value: 'Hello' } }
    );
    fireEvent.click(
      screen.getByRole('button', { name: 'Send reply via WhatsApp' })
    );
    expect((await screen.findByRole('alert')).textContent).toContain(
      'administrator'
    );
    expect(screen.queryByText(/credential encryption/)).toBeNull();
  });
});

it('shows Meta account confirmation errors in the conversation while preserving drafts', () => {
  fixture.account = {
    ...account('instagram'),
    status: 'error',
    health_error: 'meta_access_required',
  };
  mount();
  expect(screen.getByText(/Meta is blocking this app/).textContent).toContain(
    'account confirmation'
  );
  const input = screen.getByRole('textbox', {
    name: 'External customer reply',
  });
  fireEvent.input(input, { target: { value: 'Keep my draft' } });
  expect(input).toHaveProperty('value', 'Keep my draft');
  expect(
    screen.getByRole('button', { name: 'Send reply via Instagram' })
  ).toHaveProperty('disabled', true);
  expect(fixture.reply).not.toHaveBeenCalled();
});

it('keeps mobile Return as a newline, matching the native channel input', () => {
  fixture.touch = true;
  mount();
  const input = screen.getByRole('textbox', {
    name: 'External customer reply',
  });
  fireEvent.input(input, { target: { value: 'Mobile draft' } });
  fireEvent.keyDown(input, { key: 'Enter' });
  expect(fixture.reply).not.toHaveBeenCalled();
});

it('uses implemented capabilities instead of inferring controls from provider branding', () => {
  fixture.account = account('whatsapp');
  fixture.account.capabilities.modes = ['free_form'];
  fixture.account.capabilities.text_limit = 3;
  fixture.account.capabilities.text_limit_in_bytes = true;
  mount();
  expect(
    screen.queryByRole('button', { name: 'Use approved template' })
  ).toBeNull();
  expect(screen.queryByRole('button', { name: 'Attach file' })).toBeNull();
  fireEvent.input(screen.getByRole('textbox'), { target: { value: 'éé' } });
  expect(
    screen.getByRole('button', { name: 'Send reply via WhatsApp' })
  ).toHaveProperty('disabled', true);
});

it('server denial stays disabled despite legacy window and approval fields', () => {
  fixture.account = account('instagram');
  fixture.account.human_agent_approved = true;
  fixture.account.eligibility.modes = [
    { mode: 'free_form', allowed: false, reason: 'forbidden' },
  ];
  mount();
  fireEvent.input(screen.getByRole('textbox'), {
    target: { value: 'Keep this draft' },
  });
  expect(
    screen.getByRole('button', { name: 'Send reply via Instagram' })
  ).toHaveProperty('disabled', true);
  expect(screen.queryByRole('checkbox')).toBeNull();
  expect(fixture.reply).not.toHaveBeenCalled();
});

it.each(['text', 'media'] as const)(
  'sends a template without validating or clearing the separate %s draft',
  async (kind) => {
    fixture.account!.eligibility.modes = [
      { mode: 'free_form', allowed: false, reason: 'template_required' },
      { mode: 'approved_template', allowed: true },
    ];
    fixture.templates = [
      {
        id: 'approved',
        name: 'hello',
        language: 'en_US',
        components: [{ type: 'BODY', text: 'Hello' }],
        parameter_labels: [],
      },
    ];
    enableImages();
    mount();
    const text = 'x'.repeat(kind === 'text' ? 4097 : 1025);
    fixture.recover!(
      failedReply(
        kind === 'text'
          ? { type: 'text', text }
          : {
              type: 'media',
              document_id: 'saved-file',
              kind: 'image',
              caption: text,
            }
      )
    );
    fireEvent.click(screen.getByRole('button', { name: 'Choose template' }));
    fireEvent.keyDown(
      screen.getByRole('button', { name: /Approved WhatsApp template/ }),
      { key: 'ArrowDown' }
    );
    fireEvent.click(screen.getByRole('option'));
    const send = screen.getByRole('button', {
      name: 'Send reply via WhatsApp',
    });
    expect(send).toHaveProperty('disabled', false);
    fireEvent.click(send);
    await waitFor(() => expect(fixture.reply).toHaveBeenCalledOnce());
    expect(fixture.reply.mock.calls[0][0].message).toEqual({
      type: 'template',
      template_id: 'approved',
      language: 'en_US',
      parameters: [],
    });
    await waitFor(() =>
      expect(screen.getByRole('textbox')).toHaveProperty('value', text)
    );
    if (kind === 'media')
      expect(screen.getByText('Previously attached file')).toBeTruthy();
  }
);

it('accepts template fields filled out of order and keeps the draft restorable', async () => {
  fixture.account!.eligibility.modes = [
    { mode: 'free_form', allowed: false, reason: 'template_required' },
    { mode: 'approved_template', allowed: true },
  ];
  fixture.templates = [
    {
      id: 'approved',
      name: 'order_update',
      language: 'en_US',
      components: [{ type: 'BODY', text: 'Hi {{1}}, order {{2}}' }],
      parameter_labels: ['first_name', 'order'],
    },
  ];
  mount();
  fireEvent.click(screen.getByRole('button', { name: 'Choose template' }));
  fireEvent.keyDown(
    screen.getByRole('button', { name: /Approved WhatsApp template/ }),
    { key: 'ArrowDown' }
  );
  fireEvent.click(screen.getByRole('option'));
  const send = screen.getByRole('button', { name: 'Send reply via WhatsApp' });
  fireEvent.input(screen.getByLabelText('order'), { target: { value: '4' } });
  fireEvent.input(screen.getByLabelText('order'), { target: { value: '42' } });
  expect(send).toHaveProperty('disabled', true);
  const key = `macro:meta-reply:v1:channel-one:${encodeURIComponent(
    'macro|owner@fixture.test'
  )}`;
  await waitFor(() =>
    expect(JSON.parse(localStorage.getItem(key)!).parameters).toEqual([
      '',
      '42',
    ])
  );
  fireEvent.input(screen.getByLabelText('first_name'), {
    target: { value: 'Ada' },
  });
  expect(send).toHaveProperty('disabled', false);
  fireEvent.click(send);
  await waitFor(() => expect(fixture.reply).toHaveBeenCalledOnce());
  expect(fixture.reply.mock.calls[0][0].message.parameters).toEqual([
    'Ada',
    '42',
  ]);
});

it('keeps newer text in the same channel when an earlier send completes', async () => {
  let finish!: (value: unknown) => void;
  fixture.reply.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      })
  );
  mount();
  fireEvent.input(screen.getByRole('textbox'), {
    target: { value: 'First reply' },
  });
  fireEvent.click(
    screen.getByRole('button', { name: 'Send reply via WhatsApp' })
  );
  fireEvent.input(screen.getByRole('textbox'), {
    target: { value: 'New reply while waiting' },
  });
  finish({});
  await Promise.resolve();
  expect(screen.getByRole('textbox')).toHaveProperty(
    'value',
    'New reply while waiting'
  );
  fireEvent.click(
    screen.getByRole('button', { name: 'Send reply via WhatsApp' })
  );
  await waitFor(() => expect(fixture.reply).toHaveBeenCalledTimes(2));
  expect(fixture.reply.mock.calls[1][0].idempotency_key).not.toBe(
    fixture.reply.mock.calls[0][0].idempotency_key
  );
});

it('separates the submitted text from the next draft and retains an uncertain enqueue across remount', async () => {
  let reject!: (reason: Error) => void;
  fixture.reply.mockImplementationOnce(
    () =>
      new Promise((_, fail) => {
        reject = fail;
      })
  );
  mount();
  const input = screen.getByRole('textbox', {
    name: 'External customer reply',
  });
  fireEvent.input(input, { target: { value: 'First reply' } });
  fireEvent.click(
    screen.getByRole('button', { name: 'Send reply via WhatsApp' })
  );
  expect(input).toHaveProperty('value', '');
  fireEvent.input(input, { target: { value: 'Next reply' } });
  reject(new Error('Network interrupted'));
  await screen.findByRole('alert');
  expect(input).toHaveProperty('value', 'Next reply');
  const original = fixture.reply.mock.calls[0][0];
  cleanup();
  mount();
  fireEvent.click(screen.getByRole('button', { name: 'Retry previous reply' }));
  await waitFor(() => expect(fixture.reply).toHaveBeenCalledTimes(2));
  expect(fixture.reply.mock.calls[1][0]).toEqual(original);
  expect(screen.getByRole('textbox')).toHaveProperty('value', 'Next reply');
});

it('reconciles queued evidence after a lost response without restoring already-queued content', async () => {
  let reject!: (reason: Error) => void;
  const [sends, setSends] = createSignal<MetaSendProgress[]>([]);
  Object.defineProperty(fixture.account!, 'sends', {
    get: sends,
    configurable: true,
  });
  fixture.reply.mockImplementationOnce(
    () =>
      new Promise((_, fail) => {
        reject = fail;
      })
  );
  mount();
  fireEvent.input(screen.getByRole('textbox'), {
    target: { value: 'Accepted but response lost' },
  });
  fireEvent.click(
    screen.getByRole('button', { name: 'Send reply via WhatsApp' })
  );
  reject(new Error('Network interrupted'));
  await screen.findByRole('alert');
  const queued = failedReply({
    type: 'text',
    text: 'Accepted but response lost',
  });
  queued.state = 'pending';
  queued.payload = fixture.reply.mock.calls[0][0];
  setSends([queued]);
  expect(screen.getByRole('textbox')).toHaveProperty('value', '');
  expect(
    screen.queryByRole('button', { name: 'Retry previous reply' })
  ).toBeNull();
  expect(screen.queryByRole('alert')).toBeNull();
});

it('keeps restored parameters when approved template options arrive after the draft', async () => {
  const [ready, setReady] = createSignal(false);
  fixture.templatesReady = ready;
  fixture.templates = [
    {
      id: 'approved',
      name: 'order_update',
      language: 'en_US',
      components: [{ type: 'BODY', text: 'Hello {{1}}' }],
      parameter_labels: ['body 1'],
    },
  ];
  localStorage.setItem(
    `macro:meta-reply:v1:channel-one:${encodeURIComponent('macro|owner@fixture.test')}`,
    JSON.stringify({
      text: 'Separate text',
      templateMode: true,
      templateId: 'approved',
      parameters: ['Avery'],
    })
  );
  mount();
  expect(screen.queryByLabelText('body 1')).toBeNull();
  setReady(true);
  await waitFor(() =>
    expect(screen.getByLabelText('body 1')).toHaveProperty('value', 'Avery')
  );
});

it('renders attachment permission failures from the stable server code', async () => {
  enableImages();
  fixture.upload.mockRejectedValueOnce(new Error('forbidden'));
  mount();
  fireEvent.click(screen.getByRole('button', { name: 'Attach file' }));
  await fixture.selectFiles!([
    new File(['fixture'], 'photo.png', { type: 'image/png' }),
  ]);
  expect(screen.getByRole('alert').textContent).toContain(
    'channel and account access'
  );
});
