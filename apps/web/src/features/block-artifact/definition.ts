import { defineBlock, type ExtractLoadType, LoadErrors } from '@core/block';
import { err, ok } from 'neverthrow';
import { lazy } from 'solid-js';
import { loadArtifactDocument } from './queries/load-artifact';

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

    const maybeDocument = await loadArtifactDocument(source.id);
    if (maybeDocument.isErr()) return err(maybeDocument.error);
    const { documentMetadata, userAccessLevel } = maybeDocument.value;
    return ok({ documentMetadata, userAccessLevel });
  },
});

export type ArtifactData = ExtractLoadType<(typeof definition)['load']>;
