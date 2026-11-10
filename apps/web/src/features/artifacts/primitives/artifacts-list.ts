import type { DocumentEntity, WithNotification } from '@entity';
import type { ArtifactListSource } from '../context/artifact-source';
import { isArtifact } from '../core/artifact';

export type ArtifactsListView =
  | { t: 'loading' }
  | { t: 'error' }
  | { t: 'empty' }
  | { t: 'ready'; artifacts: WithNotification<DocumentEntity>[] };

/** What the Artifacts list shows: only HTML documents, in the source's order. */
export function createArtifactsList(source: ArtifactListSource) {
  const artifacts = () =>
    source
      .documents()
      .filter((entity): entity is WithNotification<DocumentEntity> =>
        isArtifact(entity)
      );

  return (): ArtifactsListView => {
    const rows = artifacts();

    if (rows.length > 0) return { t: 'ready', artifacts: rows };
    if (source.loading()) return { t: 'loading' };
    if (source.failed()) return { t: 'error' };

    return { t: 'empty' };
  };
}
