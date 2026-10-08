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
 * It also holds the live session across navigation until the destination
 * owns a reference, even when creation and the prompt POST finish first.
 *
 * Everything downstream of the block reads its session id as
 * `Accessor<string | undefined>`, so "not created yet" is the same absence
 * they already handle while the GET is in flight.
 */

import { handleAiUsageLimitError } from '@app/features/paywall/ai-usage-limit-handling';
import { AgentSession } from '@core/agent-session/AgentSession';
import {
  type PromptSubmitSurface,
  PromptTrace,
} from '@core/agent-session/prompt-telemetry';
import {
  replenishWarmAgentSession,
  takeWarmAgentSession,
} from '@queries/agent-session/warm';
import { refetchSoupEntity } from '@queries/soup/normalized-cache';
import { agentHarnessServiceClient } from '@service-agent-harness/client';
import type {
  CreateAgentSessionRequest,
  PromptAttachment,
} from '@service-agent-harness/generated/schemas';
import { type Accessor, createSignal } from 'solid-js';
import { v7 as uuidv7 } from 'uuid';
import { issueSessionAction } from '../queries/issue-session-action';
import {
  configureSessionModel,
  sessionConfigReported,
} from './configure-session-model';

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
  /** Unsent composer context supplied by an Ask AI action. */
  initialInput?: string;
};

type PendingSessionEntry = PendingSession & { dispose: () => void };

const pending = new Map<string, PendingSessionEntry>();

// A destination normally adopts the session immediately. Bound abandoned
// navigation and failed creates without making a timer part of the handoff.
// Cold sandbox provisioning can take minutes, like the prompt trace's stall bound.
const PENDING_SESSION_TTL_MS = 5 * 60_000;

/**
 * Options captured by the preflight composer before a session exists.
 */
export type StartPendingSessionOptions = {
  /** Persisted managed persona to run; omitted for Macro Coder. */
  botId?: string;
  /** Unsent composer context; never issued as a prompt. */
  initialInput?: string;
  /** First prompt. */
  prompt?: string;
  /** Uploaded SFS files delivered with the first prompt. */
  attachments?: PromptAttachment[];
  /** The sender, so the first prompt is attributed as the log will. */
  userId?: string;
  /** The submitting composer, independent of its position in a split layout. */
  submitSurface?: PromptSubmitSurface;
  /** Model to run on instead of the persona's, set as the session is created. */
  modelOverride?: string;
  /**
   * Context the surface opening the session gives the agent: its runtime reads it as
   * instructions, so neither the composer nor the sent prompt shows it.
   */
  instructions?: string;
  /** Opaque harness setting confirmed before the first prompt. */
  effortOverride?: { configId: string; value: string };
  /** Inference speed confirmed before the first prompt. */
  speedOverride?: { configId: string; value: string };
  /** Release the submitting composer's attachments after the first prompt is accepted. */
  onDelivered?: () => void;
  /** Restore the submitting draft when creation, configuration, or first delivery fails. */
  onFailure?: () => void;
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
  const warmId = takeWarmAgentSession(options);
  const id = warmId ?? uuidv7();
  const prompt = options.prompt?.trim() ?? '';
  // Started before the create so the whole wait up to the first output,
  // and every request on the way, lands in one trace.
  const trace =
    prompt || options.attachments?.length
      ? new PromptTrace(id, {
          newSession: true,
          submitSurface: options.submitSurface,
        })
      : undefined;
  const [sessionId, setSessionId] = createSignal<string>();
  const [error, setError] = createSignal<string>();
  let navigation: AgentSession | undefined;
  let disposed = false;
  const releaseNavigation = () => {
    navigation?.release();
    navigation = undefined;
  };
  const fail = (message: string, cause?: unknown) => {
    trace?.end('failed', cause ?? new Error(message));
    releaseNavigation();
    setError(message);
    options.onFailure?.();
  };
  const expiry = setTimeout(
    () => forgetPendingSession(id),
    PENDING_SESSION_TTL_MS
  );
  pending.set(id, {
    sessionId,
    failed: () => error() !== undefined,
    error,
    prompt: options.prompt?.trim() || undefined,
    initialInput: options.initialInput,
    dispose: () => {
      disposed = true;
      clearTimeout(expiry);
      releaseNavigation();
    },
  });

  const traced = <T>(operation: () => T): T =>
    trace ? trace.run(operation) : operation();

  const create = (sessionId: string) =>
    agentHarnessServiceClient.create({
      id: sessionId,
      ...(options.botId ? { botId: options.botId } : {}),
      ...(options.modelOverride ? { model: options.modelOverride } : {}),
      ...(options.instructions ? { instructions: options.instructions } : {}),
      ...(options.repoUrl
        ? { repoUrl: options.repoUrl, repoBranch: options.repoBranch }
        : {}),
    } satisfies CreateAgentSessionRequest);

  // An expired or failed reservation must not prevent ordinary creation.
  const createWithFallback = async () => {
    const result = await create(id);
    return warmId && result.isErr() ? await create(uuidv7()) : result;
  };

  void traced(() =>
    createWithFallback()
      .then(async (result) => {
        if (result.isErr()) {
          handleAiUsageLimitError(result.error);
          fail(
            result.error.map((error) => error.message).join(' ') ||
              'The agent session could not be created.'
          );
          return;
        }
        trace?.stage('created');
        // Normally the id this tab minted; an older service may mint its own.
        const created = result.value.session.id;
        // A warm claim releases its server reservation before creation answers.
        replenishWarmAgentSession(result.value.session.ownerId);
        void refetchSoupEntity(created, 'agentSession', { created: true });
        // The create already starts the session on `modelOverride`, so only
        // an effort holds the block in preflight. Then adopt the session before
        // issuing the first prompt so that prompt is folded speculatively while
        // its POST is in flight.
        if (
          options.effortOverride ||
          options.speedOverride ||
          prompt ||
          options.attachments?.length
        ) {
          const session = AgentSession.acquire(created);
          try {
            if (options.effortOverride || options.speedOverride) {
              await session.load();
              trace?.stage('loaded');
              await sessionConfigReported(session);
              await configureSessionModel(
                session,
                options.modelOverride,
                options.effortOverride
              );
              if (options.speedOverride) {
                await configureSessionModel(
                  session,
                  options.modelOverride,
                  options.speedOverride
                );
              }
              trace?.stage('configured');
            }
            // The prompt's reference ends when its POST answers. Navigation
            // owns a separate reference until the destination acquires, so a
            // fast POST cannot destroy the fold before that view mounts.
            if (!disposed) navigation = AgentSession.acquire(created);
            setSessionId(created);
            if (prompt || options.attachments?.length) {
              const delivered = await issueSessionAction(
                session,
                {
                  type: 'prompt',
                  prompt,
                  ...(options.attachments?.length
                    ? { attachments: options.attachments }
                    : {}),
                },
                {
                  userId: options.userId ?? result.value.session.ownerId,
                  trace,
                }
              );
              if (delivered.isErr()) {
                fail(
                  delivered.error.map((error) => error.message).join(' ') ||
                    'The first message could not be sent.'
                );
              } else {
                options.onDelivered?.();
              }
            }
          } catch (error) {
            fail(
              error instanceof Error
                ? error.message
                : 'The selected settings could not be applied.',
              error
            );
          } finally {
            session.release();
          }
        } else {
          setSessionId(created);
        }
      })
      .catch((error: unknown) =>
        fail(
          'Could not reach the agent service. Check your connection and try again.',
          error
        )
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
 * Release the navigation reference once the destination owns its acquisition,
 * or when a failed/abandoned create no longer needs a placeholder.
 */
export function forgetPendingSession(id: string): void {
  const entry = pending.get(id);
  pending.delete(id);
  entry?.dispose();
}
