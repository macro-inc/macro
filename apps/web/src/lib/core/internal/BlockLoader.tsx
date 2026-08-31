import { useAnalytics } from '@app/lib/analytics/analytics-context';
import type { OwnedBlockHandle } from '@core/orchestrator';
import { useQueryClient } from '@queries/client';
import type { AccessLevel as UserAccessLevel } from '@service-storage/generated/schemas/accessLevel';
import { createAsync } from '@solidjs/router';
import { err, ok } from 'neverthrow';
import { createEffect, type JSX, onCleanup, useContext } from 'solid-js';
import {
  type BlockDefinition,
  type BlockName,
  createBlockSignal,
  type FileOrTextLike,
  type LoadFunction,
  useIsNestedBlock,
} from '../block';
import { BlockOpenTrackingDelayContext } from '../context/blockOpenTracking';
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
  // Snapshot at mount so later presentation changes do not alter how an
  // already-mounted block is tracked.
  const openTrackingDelayMs = useContext(BlockOpenTrackingDelayContext);
  const analytics = useAnalytics();

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

  let openTrackTimer: ReturnType<typeof setTimeout> | undefined;
  onCleanup(() => clearTimeout(openTrackTimer));

  createEffect(() => {
    const result = getResult();
    // Any content change supersedes a still-pending "opened" track.
    clearTimeout(openTrackTimer);

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
        import('./trackBlockOpened').then(({ track }) => {
          track({
            itemId: props.id,
            blockName: data.__block,
            client: useQueryClient,
          });
        });

        analytics.pageView(data.__block);
        analytics.track('open_entity', {
          entityType: data.__block,
          entityId: props.id,
        });
      };

      if (openTrackingDelayMs > 0) {
        openTrackTimer = setTimeout(trackOpened, openTrackingDelayMs);
      } else {
        trackOpened();
      }
    }

    setData(() => data);
    setFile(() => (data && 'dssFile' in data ? data.dssFile : undefined));
    setText((text) => (data && 'text' in data ? data.text : text));
    setUserAccess<UserAccessLevel>(() =>
      data && 'userAccessLevel' in data ? data.userAccessLevel : 'view'
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
