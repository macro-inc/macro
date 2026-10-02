import { agentsRouteId } from '@app/features/agents-view/core/route';
import { startPendingSession } from '@app/features/block-agent/context/pending-session';
import { globalSplitManager } from '@app/signal/splitLayout';
import type { SplitHandle } from '@components/app/split-layout/layoutManager';
import {
  type ChatAttachmentMention,
  chatAttachmentMentionToMarkdown,
} from '@core/component/AI/util/chatAttachmentMention';
import { toast } from '@core/component/Toast/Toast';
import { fileTypeToBlockName } from '@core/constant/allBlocks';
import AgentIcon from '@phosphor/sparkle.svg';
import type { ChannelType } from '@service-cognition/generated/schemas/channelType';
import { Button } from '@ui';
import { createSignal } from 'solid-js';

export { AgentIcon as ChatWithAgentIcon };

type ChatWithAgentEntity =
  | { type: 'email'; id: string; name: string }
  | {
      type: 'document';
      id: string;
      name: string;
      fileType: string | null | undefined;
      blockParams?: Record<string, string>;
    }
  | { type: 'project'; id: string; name: string }
  | { type: 'channel'; id: string; name: string; channelType: ChannelType };

function buildMention(entity: ChatWithAgentEntity): ChatAttachmentMention {
  const blockName =
    entity.type === 'document'
      ? fileTypeToBlockName(entity.fileType, true)
      : entity.type === 'email'
        ? 'email'
        : entity.type;

  return {
    documentId: entity.id,
    documentName: entity.name,
    blockName,
    ...(entity.type === 'channel' ? { channelType: entity.channelType } : {}),
    ...(entity.type === 'document' && entity.blockParams
      ? { blockParams: entity.blockParams }
      : {}),
  };
}

async function createAndOpenAgent(seed: {
  input?: string;
  /** Sent immediately once the agent session is ready. */
  message?: string;
  /** The model the session runs on; the caller checks the plan allows it. */
  model?: string;
  /** Context for the agent alone, kept out of the composer and the transcript. */
  instructions?: string;
  /** Replaces this split's content instead of opening a new split. */
  replaceSplit?: SplitHandle;
}) {
  const manager = globalSplitManager();
  if (!seed.replaceSplit && !manager) {
    toast.failure('Unable to open chat');
    return false;
  }

  const id = startPendingSession({
    prompt: seed.message,
    initialInput: seed.message ? undefined : seed.input,
    ...(seed.model ? { modelOverride: seed.model } : {}),
    ...(seed.instructions ? { instructions: seed.instructions } : {}),
  });
  const next = {
    type: 'component' as const,
    id: agentsRouteId({
      mode: 'chat',
      conversation: { type: 'agent_session', id },
    }),
  };
  if (seed.replaceSplit) {
    seed.replaceSplit.replace({ next });
  } else {
    manager?.openWithSplit(next, { activate: true, preferNewSplit: true });
  }
  return true;
}

export async function openChatWithAgent(entity: ChatWithAgentEntity) {
  const input = `${chatAttachmentMentionToMarkdown(buildMention(entity))} `;
  return createAndOpenAgent({ input });
}

/** Open a new agent session with `initialInput` unsent, on `model`, told `instructions` privately. */
export async function openChatWithInput(
  initialInput: string,
  options?: { model?: string; instructions?: string }
) {
  await createAndOpenAgent({
    input: initialInput,
    model: options?.model,
    instructions: options?.instructions,
  });
}

/**
 * Replace `splitHandle`'s content with a new agent session seeded with `initialInput`
 * (not sent). Used by the search view's "Ask AI" button to hand off in place.
 */
export async function openChatWithInputReplacingSplit(
  initialInput: string,
  splitHandle: SplitHandle
) {
  await createAndOpenAgent({ input: initialInput, replaceSplit: splitHandle });
}

/** Open a new agent session and send `message` once it is ready. */
export async function openChatWithMessage(message: string) {
  await createAndOpenAgent({ message });
}

/**
 * Replace `splitHandle`'s content with a new agent session and immediately send
 * `message`. Used by the search view's "Ask AI" button to hand off in place.
 */
export async function openChatWithMessageReplacingSplit(
  message: string,
  splitHandle: SplitHandle
) {
  await createAndOpenAgent({ message, replaceSplit: splitHandle });
}

export function ChatWithAgentButton(props: {
  entity: ChatWithAgentEntity;
  /** Button text; defaults to "Chat". */
  label?: string;
  disabled?: boolean;
}) {
  const [opening, setOpening] = createSignal(false);
  async function open() {
    if (opening() || props.disabled) return;
    setOpening(true);
    try {
      await openChatWithAgent(props.entity);
    } finally {
      setOpening(false);
    }
  }
  return (
    <Button
      tooltip={props.label ?? 'Chat with Agent'}
      variant="outline"
      size="sm"
      onClick={() => void open()}
      disabled={props.disabled || opening()}
      aria-busy={opening()}
      depth={2}
      class="bg-surface"
    >
      <AgentIcon />
      <span class="text-xs">{props.label ?? 'Chat'}</span>
    </Button>
  );
}

export function AskMacroButton(props: { entity: ChatWithAgentEntity }) {
  return (
    <Button
      onClick={() => openChatWithAgent(props.entity)}
      variant="ghost"
      size="sm"
      depth={2}
      class="gap-1.5 border border-edge-muted px-2"
    >
      <AgentIcon />
      <span class="text-xs font-medium">Ask Macro</span>
    </Button>
  );
}
