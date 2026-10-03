import { createCollabSurfaceSession } from '@core/collab-surface/createCollabSurface';
import type {
  SequenceContentOptions,
  SequenceContentSession,
} from '../context/contracts';
import { sequenceContentId } from '../core/content-identity';

export function createSequenceContentSession(
  options: SequenceContentOptions
): SequenceContentSession {
  const sourceId = sequenceContentId(options);
  const session = createCollabSurfaceSession(sourceId, {
    parent: { entityType: 'database', entityId: options.databaseId },
    initialMarkdown: options.initialText,
  });
  return { ...session, sourceId };
}
