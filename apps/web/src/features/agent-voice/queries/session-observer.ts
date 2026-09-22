import { AgentSession } from '@core/agent-session/AgentSession';
import { connectionGatewayClient } from '@service-connection/client';
import type { VoiceSessionObserver } from '../core/types';

/** Keep the canonical session live while voice continues outside its page. */
export async function observeVoiceSession(
  sessionId: string,
  reviewRequired: (required: boolean) => void
): Promise<VoiceSessionObserver> {
  const entity = {
    entity_type: 'agent_session' as const,
    entity_id: sessionId,
  };
  await connectionGatewayClient.trackEntity({ ...entity, action: 'open' });
  const session = AgentSession.acquire(sessionId);
  let closed = false;
  let revision = 0;
  const unsubscribe = session.subscribe((events) => {
    if (closed) return;
    const metadata = events.findLast((event) => event.kind === 'metadata');
    if (!metadata) return;
    revision++;
    reviewRequired(metadata.metadata.pendingInteractions.length > 0);
  });
  // Voice can stay active in a background tab, beyond the page tracking lease.
  const heartbeat = setInterval(() => {
    void connectionGatewayClient.trackEntity({ ...entity, action: 'ping' });
  }, 20_000);
  const close = () => {
    if (closed) return;
    closed = true;
    clearInterval(heartbeat);
    unsubscribe();
    session.release();
    void connectionGatewayClient.trackEntity({ ...entity, action: 'close' });
  };
  try {
    const record = await session.load();
    if (!record.session.canEdit)
      throw new Error('You need edit access to talk to this agent.');
    const beforeSnapshot = revision;
    const snapshot = await session.snapshot();
    if (revision === beforeSnapshot)
      reviewRequired(snapshot.metadata.pendingInteractions.length > 0);
    return { close };
  } catch (error) {
    close();
    throw error;
  }
}
