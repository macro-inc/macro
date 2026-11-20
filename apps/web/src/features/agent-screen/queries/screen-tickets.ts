import type { Span } from '@macro-inc/observability';
import { agentHarnessServiceClient } from '@service-agent-harness/client';
import { err, ok, type Result } from 'neverthrow';
import { match } from 'ts-pattern';
import type { ScreenTicketRequest } from '../context/screen-context';
import type { TicketFailure } from '../core/screen-status';
import type { ScreenTicketGrant } from '../transports/types';

/** Mints a screen ticket and resolves it to the socket URL that redeems it. */
export async function requestScreenTicket(
  request: ScreenTicketRequest,
  span: Span
): Promise<Result<ScreenTicketGrant, TicketFailure>> {
  const { harnessId, ...body } = request;

  const result = await span.span('computer.screen.ticket', async (child) => {
    child.setAttr('harness.id', harnessId);
    child.setAttr('screen.transport', body.transport);
    child.setAttr('screen.surface', body.surface);
    child.setAttr('screen.mode', body.mode);
    return await agentHarnessServiceClient.mintScreenTicket(
      harnessId,
      body,
      child
    );
  });

  if (result.isErr()) {
    const code = result.error[0]?.code;
    const failure = match(code)
      .returnType<TicketFailure>()
      .with('FORBIDDEN', () => 'forbidden')
      .with('ROLLOUT_DISABLED', () => 'rolloutDisabled')
      .with('NOT_FOUND', () => 'notFound')
      .with('COMPUTER_UNAVAILABLE', () => 'unavailable')
      .otherwise(() => 'failed');
    return err(failure);
  }

  // A socket upgrade carries no custom headers: the trace context rides in
  // the query, so the harness can join the socket to this trace.
  const socketUrl = new URL(
    agentHarnessServiceClient.screenSocketUrl(result.value)
  );
  const traceparent = span.traceparent();
  if (traceparent) socketUrl.searchParams.set('traceparent', traceparent);
  return ok({
    socketUrl: socketUrl.toString(),
    expiresAt: result.value.expiresAt,
  });
}
