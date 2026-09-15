import type { ChatSendInput } from '@core/component/AI/component/input/buildRequest';
import { Model } from '@core/component/AI/constant';
import { cleanup, render } from '@solidjs/testing-library';
import { err, ok } from 'neverthrow';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HomeChatInput } from './home-chat-input';

const mocks = vi.hoisted(() => ({
  onSend: undefined as ((request: ChatSendInput) => Promise<void>) | undefined,
  draft: '',
  attached: [] as ChatSendInput['attachments'],
  setMarkdown: vi.fn(),
  setAttached: vi.fn(),
  createChat: vi.fn(),
  sendStreamChatMessage: vi.fn(),
  showPaywall: vi.fn(),
  rename: vi.fn(),
  replace: vi.fn(),
  pendingSend: vi.fn(),
  invalidateSoup: vi.fn(),
}));

vi.mock('@components/app/split-layout/layoutUtils', () => ({
  useSplitPanelOrThrow: () => ({ handle: { replace: mocks.replace } }),
}));
vi.mock('@core/component/AI/component/input/buildChatEditor', () => ({
  buildChatEditor: () => ({
    withMentions: () => ({ controls: { setMarkdown: mocks.setMarkdown } }),
  }),
}));
vi.mock('@core/component/AI/component/input/ChatInput', () => ({
  ChatInput: (props: { onSend: typeof mocks.onSend }) => {
    mocks.onSend = props.onSend;
    return null;
  },
}));
vi.mock('@core/component/AI/context', () => ({
  useChatInputContext: () => ({
    attachments: { setAttached: mocks.setAttached },
    pendingDraft: () => null,
  }),
}));
vi.mock('@core/component/AI/signal/attachment', () => ({
  useGetChatAttachmentInfo: () => ({}),
}));
vi.mock('@core/component/AI/signal/mention-attachment-callbacks', () => ({
  createMentionAttachmentCallbacks: () => ({}),
}));
vi.mock('@core/component/AI/signal/pendingSend', () => ({
  setPendingSendData: mocks.pendingSend,
}));
vi.mock('@core/constant/PaywallState', () => ({
  PaywallKey: { CHAT_LIMIT: 'chat_limit' },
  usePaywallState: () => ({ showPaywall: mocks.showPaywall }),
}));
vi.mock('@core/hotkey/hotkeys', () => ({ registerHotkey: vi.fn() }));
vi.mock('@entity', () => ({
  createRenameDssEntityMutation: () => ({ mutate: mocks.rename }),
}));
vi.mock('@queries/soup/normalized-cache', () => ({
  invalidateAllSoup: mocks.invalidateSoup,
}));
vi.mock('@service-cognition/client', () => ({
  cognitionApiServiceClient: {
    createChat: mocks.createChat,
    sendStreamChatMessage: mocks.sendStreamChatMessage,
  },
}));

const request: ChatSendInput = {
  content: 'Summarize **these documents**\nInclude the key decisions.',
  model: Model.sonnet5,
  attachments: [
    { entity_id: 'document-1', entity_type: 'document' },
    { entity_id: 'project-1', entity_type: 'project' },
  ],
  toolset: { type: 'none' },
};

beforeEach(() => {
  vi.resetAllMocks();
  // ChatInput clears the editor and attachments before invoking onSend.
  mocks.draft = '';
  mocks.attached = [];
  mocks.setMarkdown.mockImplementation((text: string) => {
    mocks.draft = text;
  });
  mocks.setAttached.mockImplementation(
    (value: ChatSendInput['attachments']) => {
      mocks.attached = value;
    }
  );
  render(() => <HomeChatInput />);
});

afterEach(cleanup);

describe('Home chat creation', () => {
  it.each([
    { code: 'NETWORK_ERROR', message: 'Request failed', paywall: false },
    { code: 'HTTP_ERROR', message: '402 payment_required', paywall: true },
    { code: 'FORBIDDEN', message: 'Chat limit reached', paywall: true },
  ])(
    'restores the submitted draft on $code before any paywall',
    async (failure) => {
      mocks.createChat.mockResolvedValue(err([failure]));
      mocks.showPaywall.mockImplementation(() => {
        expect(mocks.draft).toBe(request.content);
        expect(mocks.attached).toEqual(request.attachments);
      });

      await mocks.onSend?.(request);

      expect(mocks.createChat).toHaveBeenCalledOnce();
      expect(mocks.draft).toBe(request.content);
      expect(mocks.attached).toEqual(request.attachments);
      if (failure.paywall) {
        expect(mocks.showPaywall).toHaveBeenCalledWith('chat_limit');
      } else {
        expect(mocks.showPaywall).not.toHaveBeenCalled();
      }
      expect(mocks.rename).not.toHaveBeenCalled();
      expect(mocks.replace).not.toHaveBeenCalled();
      expect(mocks.pendingSend).not.toHaveBeenCalled();
      expect(mocks.sendStreamChatMessage).not.toHaveBeenCalled();
    }
  );

  it('restores an attachment-only submission', async () => {
    mocks.createChat.mockResolvedValue(
      err([{ code: 'NETWORK_ERROR', message: 'Failed' }])
    );

    await mocks.onSend?.({ ...request, content: '' });

    expect(mocks.draft).toBe('');
    expect(mocks.attached).toEqual(request.attachments);
  });

  it.each([false, true])(
    'keeps successful-send behavior (background=%s)',
    async (metaKey) => {
      mocks.createChat.mockResolvedValue(ok({ id: 'new-chat' }));

      await mocks.onSend?.({ ...request, metaKey });

      expect(mocks.setMarkdown).not.toHaveBeenCalled();
      expect(mocks.setAttached).not.toHaveBeenCalled();
      expect(mocks.rename).toHaveBeenCalledWith(
        expect.objectContaining({
          entity: expect.objectContaining({ type: 'chat', id: 'new-chat' }),
        })
      );
      if (metaKey) {
        expect(mocks.sendStreamChatMessage).toHaveBeenCalledWith(
          expect.objectContaining({
            chat_id: 'new-chat',
            content: request.content,
            attachments: request.attachments,
            model: request.model,
            toolset: request.toolset,
          })
        );
        expect(mocks.invalidateSoup).toHaveBeenCalledOnce();
        expect(mocks.replace).not.toHaveBeenCalled();
        expect(mocks.pendingSend).not.toHaveBeenCalled();
      } else {
        expect(mocks.pendingSend).toHaveBeenCalledWith({
          content: request.content,
          attachments: request.attachments,
          model: request.model,
        });
        expect(mocks.replace).toHaveBeenCalledWith({
          next: { type: 'chat', id: 'new-chat' },
        });
        expect(mocks.sendStreamChatMessage).not.toHaveBeenCalled();
      }
    }
  );
});
