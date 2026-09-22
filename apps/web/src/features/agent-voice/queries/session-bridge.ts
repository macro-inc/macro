import { AgentSession } from '@core/agent-session/AgentSession';
import type {
  FoldedMessage,
  SessionMetadata,
} from '@service-agent-fold/generated/types';
import { agentVoiceClient } from '@service-agent-harness/voice';
import { boundedText } from '../core/protocol';
import type {
  AgentCancelled,
  AgentTaskAccepted,
  AgentTaskEvent,
  VoiceBridge,
  VoiceContext,
} from '../core/types';

/** Only public text participates in speech; thinking/tool payloads never cross. */
export function publicMessageText(message: FoldedMessage): string {
  return message.parts
    .flatMap((part) => (part.kind === 'text' ? [part.text] : []))
    .join('\n')
    .slice(0, 8000);
}

export async function createAgentVoiceBridge(
  sessionId: string,
  userId: string,
  publish: (event: AgentTaskEvent) => void
): Promise<VoiceBridge> {
  const session = AgentSession.acquire(sessionId);
  let closed = false;
  try {
    const record = await session.load();
    if (!record.session.canEdit)
      throw new Error('You need edit access to talk to this agent.');
    const snapshot = await session.snapshot();
    let messages = snapshot.messages;
    let metadata: SessionMetadata = snapshot.metadata;
    const requests = new Map<
      string,
      { prompt: string; result: Promise<AgentTaskAccepted> }
    >();
    const cancellations = new Map<
      string,
      { payload: string; result: Promise<AgentCancelled> }
    >();
    const tasks = new Map<string, { lastEvent?: string; complete: boolean }>();
    const emit = () => {
      if (closed) return;
      for (const [taskId, task] of tasks) {
        if (task.complete) continue;
        const user = messages.find(
          (message) =>
            message.author.kind === 'user' &&
            message.requestId === taskId &&
            !message.pending
        );
        if (!user) continue;
        const reply = messages.find(
          (message) =>
            message.author.kind === 'agent' &&
            message.turn === user.turn &&
            !message.pending
        );
        const interaction = metadata.pendingInteractions.find(
          (item) => item.turn === user.turn
        );
        const type: AgentTaskEvent['type'] = reply?.stop
          ? reply.stop.kind === 'end_turn'
            ? 'completed'
            : reply.stop.kind === 'cancelled'
              ? 'cancelled'
              : 'failed'
          : interaction
            ? 'interaction'
            : 'progress';
        const text = interaction
          ? interaction.kind === 'elicitation'
            ? `${interaction.message}\nPlease answer using the review controls in the conversation.`
            : 'The agent needs permission. Please review the request in the conversation.'
          : reply?.stop?.kind === 'failed'
            ? reply.stop.message
            : reply
              ? publicMessageText(reply)
              : '';
        if (!text && type === 'progress') continue;
        const event: AgentTaskEvent = {
          version: 1,
          taskId,
          type,
          text: boundedText(text, 8000),
        };
        const key = JSON.stringify(event);
        if (key === task.lastEvent) continue;
        task.lastEvent = key;
        task.complete =
          type === 'completed' || type === 'cancelled' || type === 'failed';
        publish(event);
      }
    };
    const unsubscribe = session.subscribe((events) => {
      for (const event of events) {
        if (event.kind === 'metadata') metadata = event.metadata;
        else if (event.kind === 'replace') messages = event.messages;
        else {
          const message = event.message;
          messages = [
            ...messages.filter(
              (item) =>
                item.turn !== message.turn ||
                item.author.kind !== message.author.kind
            ),
            message,
          ];
        }
      }
      emit();
    });
    const context = async (): Promise<VoiceContext> => {
      if (closed) throw new Error('Voice has ended.');
      const latest = await session.snapshot();
      const pending = latest.metadata.pendingInteractions[0];
      const active = [...latest.messages]
        .reverse()
        .find(
          (message) =>
            message.author.kind === 'user' &&
            message.requestId &&
            !message.pending
        );
      let budget = 8000;
      const history: VoiceContext['messages'] = [];
      for (const message of latest.messages
        .filter((message) => !message.pending)
        .sort((a, b) => a.turn - b.turn || (a.author.kind === 'user' ? -1 : 1))
        .slice(-24)
        .reverse()) {
        const text = boundedText(
          publicMessageText(message),
          Math.min(2000, budget)
        );
        if (text) {
          history.unshift({
            role: message.author.kind === 'user' ? 'user' : 'assistant',
            text,
          });
          budget -=
            new TextEncoder().encode(JSON.stringify(text)).byteLength - 2;
        }
        if (budget <= 0) break;
      }
      return {
        version: 1,
        sessionId,
        messages: history,
        ...(latest.metadata.turn !== 'idle' && active?.requestId
          ? { activeTaskId: active.requestId }
          : {}),
        ...(pending
          ? {
              pendingInteraction:
                pending.kind === 'elicitation'
                  ? boundedText(pending.message, 1000)
                  : 'A permission request needs review in the conversation.',
            }
          : {}),
      };
    };
    return {
      context,
      request: (request) => {
        if (closed) return Promise.reject(new Error('Voice has ended.'));
        const existing = requests.get(request.requestId);
        if (existing)
          return existing.prompt === request.prompt
            ? existing.result
            : Promise.resolve({
                taskId: request.requestId,
                status: 'conflict',
                message: 'That request ID was already used.',
              });
        if (requests.size >= 100)
          return Promise.resolve({
            taskId: request.requestId,
            status: 'failed',
            message: 'Start a new voice session to continue.',
          });
        tasks.set(request.requestId, { complete: false });
        async function issue(): Promise<AgentTaskAccepted> {
          try {
            const result = await session.issue(
              { type: 'prompt', prompt: request.prompt },
              { userId, actionId: request.requestId }
            );
            if (result.isErr()) {
              tasks.delete(request.requestId);
              return {
                taskId: request.requestId,
                status: 'failed',
                message: boundedText(
                  result.error.map((error) => error.message).join(' '),
                  1000
                ),
              };
            }
            if (result.value.actionId !== request.requestId) {
              tasks.delete(request.requestId);
              return {
                taskId: request.requestId,
                status: 'failed',
                message:
                  'The request was accepted under another ID. Check the conversation before continuing.',
              };
            }
            emit();
            return {
              taskId: result.value.actionId,
              status: result.value.status === 'queued' ? 'queued' : 'accepted',
            };
          } catch {
            return {
              taskId: request.requestId,
              status: 'failed',
              message:
                'The request could not be confirmed. Check the conversation before trying again.',
            };
          }
        }
        const result = issue();
        requests.set(request.requestId, { prompt: request.prompt, result });
        return result;
      },
      cancel: (request) => {
        if (closed) return Promise.reject(new Error('Voice has ended.'));
        const payload = JSON.stringify(request);
        const existing = cancellations.get(request.requestId);
        if (existing)
          return existing.payload === payload
            ? existing.result
            : Promise.resolve({ status: 'conflict' });
        if (!tasks.has(request.taskId))
          return Promise.resolve({
            status: 'conflict',
            message: 'This voice conversation does not own that task.',
          });
        if (cancellations.size >= 100)
          return Promise.resolve({
            status: 'failed',
            message: 'Start a new voice conversation to continue.',
          });
        const replacement = request.replacementPrompt
          ? { actionId: request.requestId, prompt: request.replacementPrompt }
          : undefined;
        // A replacement can finish before the HTTP response arrives. Track it
        // before issuing the write, and never discard an ambiguous write.
        if (replacement) tasks.set(replacement.actionId, { complete: false });
        async function cancel(): Promise<AgentCancelled> {
          try {
            const response = await agentVoiceClient.cancel(sessionId, {
              requestId: request.requestId,
              expectedActionId: request.taskId,
              ...(replacement ? { replacement } : {}),
            });
            if (response.isErr())
              return {
                status: 'conflict',
                message:
                  'The task changed or could not be stopped. Check the conversation.',
              };
            emit();
            return {
              status: response.value.status,
              ...(response.value.replacementActionId
                ? { replacementTaskId: response.value.replacementActionId }
                : {}),
            };
          } catch {
            return {
              status: 'failed',
              message:
                'Cancellation could not be confirmed. Check the conversation.',
            };
          }
        }
        const result = cancel();
        cancellations.set(request.requestId, { payload, result });
        return result;
      },
      close: () => {
        if (closed) return;
        closed = true;
        unsubscribe();
        session.release();
      },
    };
  } catch (error) {
    session.release();
    throw error;
  }
}
