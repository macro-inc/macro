import type { ChatSendInput } from '@core/component/AI/component/input/buildRequest';
import { Model } from '@core/component/AI/constant';
import { cleanup, render } from '@solidjs/testing-library';
import { err, ok } from 'neverthrow';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HomeChatInput } from './home-chat-input';

const mocks = vi.hoisted(() => ({
  agentsEnabled: false,
  generating: false,
  createSession: vi.fn(),
  controlSession: vi.fn(),
  buildAgentPrompt: vi.fn(),
  toastFailure: vi.fn(),
  toastSuccess: vi.fn(),
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

vi.mock('@app/lib/analytics/posthog', () => ({
  useFeatureFlag: () => () => ({ enabled: mocks.agentsEnabled }),
}));
vi.mock('@core/constant/featureFlags', () => ({ enableChatV3Agents: {} }));
vi.mock('@queries/agent-session/mutations', () => ({
  useCreateAgentSessionMutation: () => ({ mutateAsync: mocks.createSession }),
  useAgentSessionControlMutation: () => ({ mutateAsync: mocks.controlSession }),
}));
vi.mock('./queries/home-agent-prompt', () => ({
  buildHomeAgentPrompt: mocks.buildAgentPrompt,
}));
vi.mock('@core/component/Toast/Toast', () => ({
  toast: { failure: mocks.toastFailure, success: mocks.toastSuccess },
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
    isGenerating: () => mocks.generating,
    setIsGenerating: (value: boolean) => {
      mocks.generating = value;
    },
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
  mocks.agentsEnabled = false;
  mocks.generating = false;
  mocks.buildAgentPrompt.mockResolvedValue('prompt with attachment mentions');
  mocks.createSession.mockResolvedValue({ session: { id: 'new-agent' } });
  mocks.controlSession.mockResolvedValue({});
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

describe('Home Agent V3 creation', () => {
  it.each([false, true])(
    'uses the flag at send time and preserves background=%s',
    async (metaKey) => {
      mocks.agentsEnabled = true;
      await mocks.onSend?.({ ...request, metaKey });
      expect(mocks.createChat).not.toHaveBeenCalled();
      expect(mocks.pendingSend).not.toHaveBeenCalled();
      expect(mocks.createSession).toHaveBeenCalledWith({});
      expect(mocks.buildAgentPrompt).toHaveBeenCalledWith({
        ...request,
        metaKey,
      });
      expect(mocks.controlSession.mock.calls).toEqual([
        [
          {
            sessionId: 'new-agent',
            request: { type: 'setModel', model: request.model },
          },
        ],
        [
          {
            sessionId: 'new-agent',
            request: {
              type: 'prompt',
              prompt: 'prompt with attachment mentions',
            },
          },
        ],
      ]);
      if (metaKey) {
        expect(mocks.replace).not.toHaveBeenCalled();
        expect(mocks.toastSuccess).toHaveBeenCalled();
        mocks.toastSuccess.mock.calls[0][1].actions[0].onClick();
      }
      expect(mocks.replace).toHaveBeenCalledWith({
        next: { type: 'agent', id: 'new-agent' },
      });
      expect(mocks.generating).toBe(false);
    }
  );

  it('restores a failed creation and retries', async () => {
    mocks.agentsEnabled = true;
    mocks.createSession.mockRejectedValueOnce(new Error('Unavailable'));
    await mocks.onSend?.(request);
    expect(mocks.draft).toBe(request.content);
    expect(mocks.attached).toEqual(request.attachments);
    expect(mocks.toastFailure).toHaveBeenCalled();
    expect(mocks.replace).not.toHaveBeenCalled();
    expect(mocks.generating).toBe(false);
    await mocks.onSend?.(request);
    expect(mocks.createSession).toHaveBeenCalledTimes(2);
  });

  it.each(['setModel', 'prompt'])(
    'reuses the created session after %s fails',
    async (operation) => {
      mocks.agentsEnabled = true;
      mocks.controlSession.mockImplementationOnce(async () => {
        if (operation === 'setModel') throw new Error('Failed');
        return {};
      });
      if (operation === 'prompt')
        mocks.controlSession.mockRejectedValueOnce(new Error('Failed'));
      await mocks.onSend?.(request);
      expect(mocks.replace).not.toHaveBeenCalled();
      expect(mocks.draft).toBe(request.content);
      expect(mocks.attached).toEqual(request.attachments);
      await mocks.onSend?.(request);
      expect(mocks.createSession).toHaveBeenCalledOnce();
      expect(mocks.replace).toHaveBeenCalledOnce();
      expect(
        mocks.controlSession.mock.calls.filter(
          ([args]) => args.request.type === 'setModel'
        )
      ).toHaveLength(operation === 'setModel' ? 2 : 1);
    }
  );

  it('prepares attachments before creating a session and restores failures', async () => {
    mocks.agentsEnabled = true;
    mocks.buildAgentPrompt.mockRejectedValueOnce(
      new Error('Attachment unavailable')
    );
    await mocks.onSend?.(request);
    expect(mocks.createSession).not.toHaveBeenCalled();
    expect(mocks.draft).toBe(request.content);
    expect(mocks.attached).toEqual(request.attachments);
  });

  it('prevents concurrent session creation', async () => {
    mocks.agentsEnabled = true;
    const first = mocks.onSend?.(request);
    await mocks.onSend?.(request);
    await first;
    expect(mocks.createSession).toHaveBeenCalledOnce();
    expect(mocks.controlSession).toHaveBeenCalledTimes(2);
  });
});
