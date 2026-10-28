/**
 * The status pill's input, read off the fold's metadata.
 *
 * Status is a projection of the log - the last system event's wire name -
 * and the fold carries it on `SessionMetadata.status`, so the pill needs no
 * feed of its own. `null` means the runtime has reported nothing yet, which
 * the pill shows as Starting.
 */

import type { SessionStatusLike } from '@core/component/AgentSessionStatusPill';
import type { SessionMetadata } from '@service-agent-fold/generated/types';

export function sessionStatus(
  metadata: SessionMetadata | undefined
): SessionStatusLike {
  const status = metadata?.status;
  if (!status) return { kind: 'no_messages' };
  return { kind: 'event', event: status };
}
