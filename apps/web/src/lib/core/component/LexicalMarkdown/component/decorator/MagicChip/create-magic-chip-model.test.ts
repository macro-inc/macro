import type { MagicChipDecoratorProps } from '@macro-inc/lexical-core';
import type {
  FoldedMessage,
  PendingElicitation,
  SessionMetadata,
} from '@service-agent-fold/generated/types';
import { createRoot } from 'solid-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const sessionFold = vi.hoisted(() => ({
  acquireAgentSessionFold: vi.fn(),
  subscribeAgentSessionLog: vi.fn(),
}));
const serviceClient = vi.hoisted(() => ({ get: vi.fn(), control: vi.fn() }));
const viewer = vi.hoisted(() => ({ id: 'macro|wolf@macro.com' }));

vi.mock('@queries/agent-session/session-fold', () => sessionFold);
vi.mock('@service-agent-harness/client', () => ({
  agentHarnessServiceClient: serviceClient,
}));
vi.mock('@core/context/user', () => ({ useUserId: () => () => viewer.id }));
vi.mock('@core/user', () => ({
  tryMacroId: (id: string) => (id.startsWith('macro|') ? id : undefined),
  getDisplayName: (id: string) =>
    id === 'macro|alice@macro.com' ? 'Alice Owner' : '',
}));
vi.mock('@core/component/Toast/Toast', () => ({
  toast: { failure: vi.fn(), success: vi.fn() },
}));

import { createMagicChipModel } from './create-magic-chip-model';

const prompt: FoldedMessage = {
  requestId: null,
  agentSessionId: 'session',
  turn: 0,
  author: { kind: 'user', userId: 'macro|wolf@macro.com' },
  parts: [{ kind: 'text', text: 'Say hi' }],
  stop: null,
};

const response: FoldedMessage = {
  requestId: null,
  agentSessionId: 'session',
  turn: 0,
  author: { kind: 'agent' },
  parts: [{ kind: 'text', text: 'Hi!' }],
  stop: { kind: 'end_turn' },
};

const openResponse: FoldedMessage = {
  ...response,
  parts: [{ kind: 'text', text: 'Setting that up.' }],
  stop: null,
};

const question: PendingElicitation = {
  requestId: 9,
  turn: 0,
  toolCall: 'toolu_evt',
  message: 'Create calendar event?',
  request: {
    kind: 'user_tool',
    tool: 'CreateCalendarEvent',
    draft: { title: 'Q3 sync' },
    schema: { title: null, description: null, properties: [], required: [] },
  },
};

const metadata = (
  pendingElicitation: PendingElicitation | null
): SessionMetadata => ({ pendingElicitation }) as unknown as SessionMetadata;

const props = {
  agentSessionId: 'session',
  promptedMessage: { turn: 0, author: 'user' },
  status: 'acp_ready',
} as MagicChipDecoratorProps;

/** Let the fold acquisition and the status fetch settle. */
const settle = async () => {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
};

describe('createMagicChipModel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    viewer.id = 'macro|wolf@macro.com';
    sessionFold.subscribeAgentSessionLog.mockReturnValue(vi.fn());
    sessionFold.acquireAgentSessionFold.mockResolvedValue({
      messages: [prompt, response],
      metadata: metadata(null),
      release: vi.fn(),
    });
    serviceClient.get.mockResolvedValue({
      isOk: () => true,
      value: {
        status: { kind: 'disconnected' },
        ownerId: 'macro|alice@macro.com',
      },
    });
    serviceClient.control.mockResolvedValue({ isErr: () => false });
  });

  it('settles after the attached turn completes despite stale acp_ready status', async () => {
    let presentation!: ReturnType<typeof createMagicChipModel>['presentation'];
    const dispose = createRoot((rootDispose) => {
      presentation = createMagicChipModel(props).presentation;
      return rootDispose;
    });

    await settle();

    expect(presentation()).toEqual({ kind: 'settled', markdown: 'Hi!' });
    expect(sessionFold.acquireAgentSessionFold).toHaveBeenCalledWith({
      agentSessionId: 'session',
      onChange: expect.any(Function),
      onMetadata: expect.any(Function),
    });

    dispose();
  });

  it('hydrates a disconnected status from the session', async () => {
    sessionFold.acquireAgentSessionFold.mockResolvedValue({
      messages: [],
      metadata: metadata(null),
      release: vi.fn(),
    });
    let presentation!: ReturnType<typeof createMagicChipModel>['presentation'];
    const dispose = createRoot((rootDispose) => {
      presentation = createMagicChipModel(props).presentation;
      return rootDispose;
    });

    await settle();

    expect(presentation()).toEqual({
      kind: 'working',
      activity: { label: 'Session disconnected', busy: false },
    });

    dispose();
  });

  it('offers a question asked in its turn, to the owner, and answers on the request id', async () => {
    viewer.id = 'macro|alice@macro.com';
    sessionFold.acquireAgentSessionFold.mockResolvedValue({
      messages: [prompt, openResponse],
      metadata: metadata(question),
      release: vi.fn(),
    });
    let model!: ReturnType<typeof createMagicChipModel>;
    const dispose = createRoot((rootDispose) => {
      model = createMagicChipModel(props);
      return rootDispose;
    });

    await settle();

    expect(model.presentation()).toEqual({
      kind: 'asking',
      markdown: 'Setting that up.',
      asking: { question, canAnswer: true, ownerName: 'Alice Owner' },
    });
    expect(await model.elicitation.respond({ action: 'decline' })).toBe(true);
    expect(serviceClient.control).toHaveBeenCalledWith('session', {
      type: 'respondElicitation',
      requestId: 9,
      action: 'decline',
    });

    dispose();
  });

  it('shows another viewer who is being waited on, and sends nothing for them', async () => {
    sessionFold.acquireAgentSessionFold.mockResolvedValue({
      messages: [prompt, openResponse],
      metadata: metadata(question),
      release: vi.fn(),
    });
    let model!: ReturnType<typeof createMagicChipModel>;
    const dispose = createRoot((rootDispose) => {
      model = createMagicChipModel(props);
      return rootDispose;
    });

    await settle();

    const presentation = model.presentation();
    expect(presentation.kind).toBe('asking');
    if (presentation.kind === 'asking') {
      expect(presentation.asking.canAnswer).toBe(false);
      expect(presentation.asking.ownerName).toBe('Alice Owner');
    }
    expect(await model.elicitation.respond({ action: 'decline' })).toBe(false);
    expect(serviceClient.control).not.toHaveBeenCalled();

    dispose();
  });

  it("a question from a later turn is not this chip's, and the live metadata moves it", async () => {
    let onMetadata: ((metadata: SessionMetadata) => void) | undefined;
    sessionFold.acquireAgentSessionFold.mockImplementation(
      (args: { onMetadata?: (metadata: SessionMetadata) => void }) => {
        onMetadata = args.onMetadata;
        return Promise.resolve({
          messages: [prompt, openResponse],
          metadata: metadata({ ...question, turn: 3 }),
          release: vi.fn(),
        });
      }
    );
    let presentation!: ReturnType<typeof createMagicChipModel>['presentation'];
    const dispose = createRoot((rootDispose) => {
      presentation = createMagicChipModel(props).presentation;
      return rootDispose;
    });

    await settle();
    expect(presentation().kind).toBe('answering');

    onMetadata?.(metadata(question));
    expect(presentation().kind).toBe('asking');

    onMetadata?.(metadata(null));
    expect(presentation().kind).toBe('answering');

    dispose();
  });
});
