import { useSharedAccessUpdates } from '@app/features/access-requests/access-requests';
import { shareEntity } from '@app/features/access-requests/core/types';
import { useAnalytics } from '@app/lib/analytics/analytics-context';
import { useIsAuthenticated } from '@core/context/user';
import type { OwnedBlockHandle } from '@core/orchestrator';
import { Telemetry } from '@macro-inc/observability';
import { useQueryClient } from '@queries/client';
import { blockNameToItemType } from '@service-storage/client';
import type { AccessLevel as UserAccessLevel } from '@service-storage/generated/schemas/accessLevel';
import { createAsync } from '@solidjs/router';
import { err, ok } from 'neverthrow';
import { createEffect, type JSX, onCleanup, untrack } from 'solid-js';
import {
  type BlockDefinition,
  type BlockName,
  createBlockSignal,
  type FileOrTextLike,
  type LoadFunction,
  useIsNestedBlock,
} from '../block';
import {
  blockEditPermissionEnabledSignal,
  blockErrorSignal,
  blockFileSignal,
  blockHandleSignal,
  blockLoadRetrySignal,
  blockLoroManagerSignal,
  blockMetadataSignal,
  blockSourceSignal,
  blockSyncSourceSignal,
  blockTextSignal,
  blockUserAccessSignal,
} from '../signal/load';
import type { Source, SourcePreload } from '../source';
import type { ObjectLike } from '../util/result';
import { loadBlockDataAfterComponentPreload } from './loadBlockData';

export const blockDataSignal = createBlockSignal<unknown>();
export const blockLiveTrackingEnabledSignal = createBlockSignal<boolean>();

type BlockLoaderProps<
  D extends ObjectLike | FileOrTextLike,
  P extends SourcePreload<ObjectLike>,
  L extends LoadFunction<D, P>,
  T extends BlockDefinition<D, BlockName, P, L>,
> = {
  source: Source | P;
  definition: T;
  id: string;
  handle?: OwnedBlockHandle<any>;
};

export function BlockLoader<
  D extends ObjectLike | FileOrTextLike,
  P extends SourcePreload<ObjectLike>,
  L extends LoadFunction<D, P>,
  T extends BlockDefinition<D, BlockName, P, L>,
>(props: BlockLoaderProps<D, P, L, T>): JSX.Element {
  const authenticated = useIsAuthenticated();
  const setData = blockDataSignal.set;
  const setError = blockErrorSignal.set;
  const setLiveTrackingEnabled = blockLiveTrackingEnabledSignal.set;
  const setFile = blockFileSignal.set;
  const setText = blockTextSignal.set;
  const setUserAccess = blockUserAccessSignal.set;
  const setDocumentMetadata = blockMetadataSignal.set;
  const setLoroManagerSignal = blockLoroManagerSignal.set;
  const [syncSource, setSyncSourceSignal] = blockSyncSourceSignal;
  const setSourceSignal = blockSourceSignal.set;
  const setEditPermissionEnabled = blockEditPermissionEnabledSignal.set;
  const setHandle = blockHandleSignal.set;
  const isNested = useIsNestedBlock();
  const analytics = useAnalytics();
  const currentSharedAccess = useSharedAccessUpdates(
    () => shareEntity(blockNameToItemType(props.definition.name), props.id),
    (level, previous) => {
      const data = blockDataSignal.get();
      const hasLoadedPermissions =
        data != null && typeof data === 'object' && 'userAccessLevel' in data;
      // Lightweight loaders (e.g. email) supply no permissions. Their initial
      // fallback is not a confirmed access change that requires a remount.
      const accessChanged = hasLoadedPermissions
        ? blockUserAccessSignal.get() !== level
        : previous !== undefined && previous !== level;
      if (level === null) {
        clearLoadedDocument();
        setError('UNAUTHORIZED');
      } else if (
        (data != null && accessChanged) ||
        blockErrorSignal.get() === 'UNAUTHORIZED'
      ) {
        clearLoadedDocument();
        setError(undefined);
        blockLoadRetrySignal.set((count) => (count ?? 0) + 1);
      } else if (
        data != null &&
        !hasLoadedPermissions &&
        !blockErrorSignal.get()
      ) {
        setUserAccess(level);
      }
    }
  );

  function clearLoadedDocument() {
    untrack(syncSource)?.cleanup();
    setData(undefined);
    setFile(undefined);
    setText(undefined);
    setUserAccess(undefined);
    setDocumentMetadata(undefined);
    setSyncSourceSignal(undefined);
    setLoroManagerSignal(undefined);
    setSourceSignal(undefined);
    setHandle(undefined);
  }

  setLiveTrackingEnabled(props.definition.liveTrackingEnabled ?? false);
  setEditPermissionEnabled(props.definition.editPermissionEnabled ?? false);

  const retryToken = blockLoadRetrySignal.get;

  const getResult = createAsync(async () => {
    // Tracked before the first await so a failure view can re-run the load.
    retryToken();
    const result = await loadBlockDataAfterComponentPreload(
      () => props.definition.load(props.source, 'initial'),
      props.definition.component.preload
    );
    if (result.isErr()) {
      return err(result.error);
    }
    const data = result.value;
    if ('type' in data && data.type === 'preload') {
      console.error(
        `BlockLoader received a nested preload.
Check that the load function does not return a preload source when the intent is not preload`
      );
      return err([
        {
          code: 'INVALID' as const,
          message: 'BlockLoader received a nested preload',
        },
      ]);
    }
    return ok({
      ...data,
      __block: props.definition.name,
    });
  });

  onCleanup(() => {
    if (syncSource()) {
      syncSource()!.cleanup();
    }
  });

  createEffect(() => {
    const result = getResult();

    // An earlier in-flight load must not restore a document after revocation.
    if (untrack(currentSharedAccess) === null) {
      if (result?.isOk() && 'syncSource' in result.value)
        result.value.syncSource.cleanup();
      clearLoadedDocument();
      setError('UNAUTHORIZED');
      return;
    }

    if (!result) {
      setData(undefined);
      setFile(undefined);
      setText(undefined);
      setUserAccess(undefined);
      setDocumentMetadata(undefined);
      setError(undefined);
      setSyncSourceSignal(undefined);
      setLoroManagerSignal(undefined);
      setSourceSignal(undefined);
      setHandle(undefined);
      return;
    }

    if (result.isErr()) {
      setError(() => {
        if (result.error.some((error) => error.code === 'UNAUTHORIZED')) {
          return 'UNAUTHORIZED';
        } else if (result.error.some((error) => error.code === 'MISSING')) {
          return 'MISSING';
        } else if (result.error.some((error) => error.code === 'GONE')) {
          return 'GONE';
        }
        return 'INVALID';
      });
      return;
    }

    const data = result.value;
    setError(null);

    if (!isNested && data && props.definition.openTrackingEnabled !== false) {
      const trackOpened = () => {
        // we need to pass in a client accessor since the mutation is dynamically imported outside a query context provider
        import('./trackBlockOpened')
          .then(({ track }) => {
            if (authenticated() !== true) return;
            track({
              itemId: props.id,
              blockName: data.__block,
              client: useQueryClient,
            });
          })
          .catch((error) =>
            Telemetry.error(error, {
              surface: 'track-block-opened',
              blockName: data.__block,
            })
          );

        analytics.pageView(data.__block);
        analytics.track('open_entity', {
          entityType: data.__block,
          entityId: props.id,
        });
      };

      trackOpened();
    }

    setData(() => data);
    setFile(() => (data && 'dssFile' in data ? data.dssFile : undefined));
    setText((text) => (data && 'text' in data ? data.text : text));
    setUserAccess<UserAccessLevel>(() =>
      data && 'userAccessLevel' in data
        ? data.userAccessLevel
        : (untrack(currentSharedAccess) ?? 'view')
    );
    setDocumentMetadata(() => {
      if (data && 'projectMetadata' in data) {
        // FIXME hacky map from projectMetadata to a documentMetadata mold
        return {
          createdAt: data.projectMetadata.createdAt,
          documentId: data.projectMetadata.id,
          documentName: data.projectMetadata.name,
          updatedAt: data.projectMetadata.updatedAt,
          owner: data.projectMetadata.userId,
        };
      }
      return data && 'documentMetadata' in data
        ? data.documentMetadata
        : undefined;
    });

    setLoroManagerSignal(() =>
      data && 'loroManager' in data ? data.loroManager : undefined
    );

    setSyncSourceSignal(() =>
      data && 'syncSource' in data ? data.syncSource : undefined
    );

    setSourceSignal(props.source as Source);

    setHandle(props.handle);
  });

  return '';
}
