import {
  defineBlock,
  type ExtractLoadType,
  LoadErrors,
  loadResult,
} from '@core/block';
import { storageServiceClient } from '@service-storage/client';
import { err, ok } from 'neverthrow';
import { lazy } from 'solid-js';

/** Agent-published HTML pages with versions and scenes. */
export const definition = defineBlock({
  name: 'artifact',
  description: 'view artifacts',
  accepted: {
    artifact: 'application/x-macro-artifact',
  },
  component: lazy(() => import('./artifact-block')),
  liveTrackingEnabled: true,
  editPermissionEnabled: true,
  async load(source, intent) {
    if (source.type !== 'dss') return LoadErrors.INVALID;
    if (intent === 'preload') return ok({ type: 'preload', origin: source });

    // The pages themselves load in the frame from the artifact's origin.
    const maybeDocument = await loadResult(
      storageServiceClient.getDocumentMetadata({ documentId: source.id })
    );
    if (maybeDocument.isErr()) return err(maybeDocument.error);
    const { documentMetadata, userAccessLevel } = maybeDocument.value;
    return ok({ documentMetadata, userAccessLevel });
  },
});

export type ArtifactData = ExtractLoadType<(typeof definition)['load']>;
