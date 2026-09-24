/**
 * Sessions that exist on screen before they exist on the server.
 *
 * `POST /agent-sessions` does not answer until its Daytona sandbox is booted,
 * cloned and answering — minutes, not milliseconds. Waiting on that before
 * opening anything means staring at a spinner for the whole provision, so the
 * session's id is minted here and the block opens against it immediately;
 * the create carries the same id, so the URL, the sidebar row and every
 * reference are final from the first frame and nothing has to be adopted
 * or rewritten when the server answers.
 *
 * The registry is module-level on purpose: the create is in flight before any
 * block mounts, and must survive the mount either way round — resolving
 * before the block is on screen is normal, not a race. It is what tells a
 * block "not created yet" apart from "a session to load": an id in here is
 * waiting on its create; any other id is loaded as it is.
 *
 * Everything downstream of the block reads its session id as
 * `Accessor<string | undefined>`, so "not created yet" is the same absence
 * they already handle while the GET is in flight.
 */

import { AgentSession } from '@core/agent-session/AgentSession';
import { refetchSoupEntity } from '@queries/soup/normalized-cache';
import { agentHarnessServiceClient } from '@service-agent-harness/client';
import type {
  CreateAgentSessionRequest,
  PromptAttachment,
} from '@service-agent-harness/generated/schemas';
import { type Accessor, createSignal } from 'solid-js';
import { v7 as uuidv7 } from 'uuid';

export type PendingSession = {
  /** The session's id, once the create has made it real. */
  sessionId: Accessor<string | undefined>;
  /** The create failed — this block has nothing to become. */
  failed: Accessor<boolean>;
  /** The startup error returned by the service. */
  error: Accessor<string | undefined>;
  /**
   * The first prompt, so the block can show it as sent from the moment it
   * opens rather than once the create has answered.
   */
  prompt: string | undefined;
};

const pending = new Map<string, PendingSession>();

/**
 * Options captured by the preflight composer before a session exists.
 */
export type StartPendingSessionOptions = {
  /** Persisted managed persona to run; omitted for Macro Coder. */
  botId?: string;
  /** First prompt. */
  prompt?: string;
  /** Uploaded SFS files delivered with the first prompt. */
  attachments?: PromptAttachment[];
  /** The sender, so the first prompt is attributed as the log will. */
  userId?: string;
  /** Model to run on instead of the persona's, set as the session is created. */
  modelOverride?: string;
  /**
   * Explicit GitHub repository for the managed Cursor session.
   */
  repoUrl?: string;
  /** Starting branch for the selected repository. */
  repoBranch?: string;
};

/**
 * Start creating a managed session and return its id, to open a block
 * against right now. The POST runs unattended; nothing awaits it.
 *
 * The id is minted here and sent with the create - a v7 UUID like the ones
 * the harness mints for actions, so it sorts by time with the server's own.
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
    prompt: options.prompt?.trim() || undefined,
  });

  void agentHarnessServiceClient
    .create({
      id,
      ...(options.botId ? { botId: options.botId } : {}),
      ...(options.modelOverride ? { model: options.modelOverride } : {}),
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
      // Normally the id this tab minted; a service that predates the field
      // mints its own, and the block adopts that one the way it always did.
      const created = result.value.session.id;
      void refetchSoupEntity(created, 'agentSession', { created: true });
      // The block adopts the session the moment it exists. The first prompt
      // then goes through the shared session like any other, so it is folded
      // speculatively - bubble and working line on screen at once - while
      // the control POST waits out the runtime handshake. Delivering it
      // first and adopting after left the transcript empty for that wait.
      setSessionId(created);
      const prompt = options.prompt?.trim() ?? '';
      if (prompt || options.attachments?.length) {
        const session = AgentSession.acquire(created);
        try {
          const delivered = await session.issue(
            {
              type: 'prompt',
              prompt,
              ...(options.attachments?.length
                ? { attachments: options.attachments }
                : {}),
            },
            { userId: options.userId }
          );
          if (delivered.isErr()) {
            setError(
              delivered.error.map((error) => error.message).join(' ') ||
                'The first message could not be sent.'
            );
          }
        } finally {
          session.release();
        }
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
 * The create in flight for `id`, or undefined when there is none: the id is
 * a session to load as it is - including one whose create belonged to a tab
 * that is gone, which then loads (or fails to) like any other.
 */
export function pendingSession(id: string): PendingSession | undefined {
  return pending.get(id);
}

/**
 * Drop a settled create. Called once the block has seen it land or fail, so
 * the map does not grow for the life of the tab.
 */
export function forgetPendingSession(id: string): void {
  pending.delete(id);
}
