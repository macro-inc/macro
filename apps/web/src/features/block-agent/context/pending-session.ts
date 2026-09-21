/**
 * Sessions that exist on screen before they exist on the server.
 *
 * `POST /agent-sessions` does not answer until its Daytona sandbox is booted,
 * cloned and answering — minutes, not milliseconds. Waiting on that before
 * opening anything means staring at a spinner for the whole provision, so the
 * block opens immediately against a client-minted session id, and the POST
 * adopts that same id when it lands.
 *
 * The registry is module-level on purpose: the create is in flight before any
 * block mounts, and must survive the mount either way round — resolving
 * before the block is on screen is normal, not a race.
 *
 * Everything downstream of the block reads its session id as
 * `Accessor<string | undefined>`, so "not created yet" is the same absence
 * they already handle while the GET is in flight.
 */

import { markMessageSent } from '@core/util/message-send-motion';
import { agentHarnessServiceClient } from '@service-agent-harness/client';
import type {
  CreateAgentSessionRequest,
  PromptAttachment,
} from '@service-agent-harness/generated/schemas';
import { type Accessor, createSignal } from 'solid-js';
import { v7 as uuidv7 } from 'uuid';

export type PendingSession = {
  /** The real session id, once the create resolves. */
  sessionId: Accessor<string | undefined>;
  /** The create failed — this block has nothing to become. */
  failed: Accessor<boolean>;
  /** The startup error returned by the service. */
  error: Accessor<string | undefined>;
};

const pending = new Map<string, PendingSession>();

/**
 * Options captured by the preflight composer before a session exists.
 */
export type StartPendingSessionOptions = {
  /** Persisted managed persona to run; omitted for Macro Coder. */
  botId?: string;
  /** First prompt, delivered after any model override. */
  prompt?: string;
  /** Uploaded SFS files delivered with the first prompt. */
  attachments?: PromptAttachment[];
  /** Optional model switch applied before the first prompt. */
  modelOverride?: string;
  /**
   * Explicit GitHub repository for the managed Cursor session.
   */
  repoUrl?: string;
  /** Starting branch for the selected repository. */
  repoBranch?: string;
};

/**
 * Start creating a managed session and return the id to open a block against
 * right now. The POST runs unattended and adopts this id; nothing awaits it.
 */
export function startPendingSession(
  options: StartPendingSessionOptions = {}
): string {
  const id = uuidv7();
  const [sessionId, setSessionId] = createSignal<string>();
  const [error, setError] = createSignal<string>();
  pending.set(id, {
    sessionId,
    failed: () => error() !== undefined,
    error,
  });

  void agentHarnessServiceClient
    .create({
      id,
      ...(options.botId ? { botId: options.botId } : {}),
      ...(options.repoUrl
        ? { repoUrl: options.repoUrl, repoBranch: options.repoBranch }
        : {}),
    } satisfies CreateAgentSessionRequest)
    .then(async (result) => {
      if (result.isErr()) {
        setError(
          result.error.map((error) => error.message).join(' ') ||
            'The agent session could not be created.'
        );
        return;
      }
      const createdId = result.value.session.id;
      if (options.modelOverride) {
        const changed = await agentHarnessServiceClient.control(createdId, {
          type: 'setModel',
          model: options.modelOverride,
        });
        if (changed.isErr()) {
          setError(
            changed.error.map((error) => error.message).join(' ') ||
              'The selected model could not be applied.'
          );
          return;
        }
      }
      const prompt = options.prompt?.trim() ?? '';
      if (prompt || options.attachments?.length) {
        const delivered = await agentHarnessServiceClient.control(createdId, {
          type: 'prompt',
          prompt,
          ...(options.attachments?.length
            ? { attachments: options.attachments }
            : {}),
        });
        if (delivered.isErr()) {
          setError(
            delivered.error.map((error) => error.message).join(' ') ||
              'The first message could not be sent.'
          );
          return;
        }
        markMessageSent(`agent:${createdId}:${delivered.value.actionId}`);
      }
      setSessionId(createdId);
      if (createdId === id) {
        pending.delete(id);
      }
    })
    .catch(() =>
      setError(
        'Could not reach the agent service. Check your connection and try again.'
      )
    );

  return id;
}

/**
 * The pending session behind a just-minted id, or undefined when there is
 * none — a session URL whose create belonged to another tab, or a reload.
 */
export function pendingSession(id: string): PendingSession | undefined {
  return pending.get(id);
}

/**
 * Drop a resolved pending create. Called once the block has adopted the id,
 * so the map does not grow for the life of the tab.
 */
export function forgetPendingSession(id: string): void {
  pending.delete(id);
}
