import { useSharedAccessUpdates } from '@app/features/access-requests/access-requests';
import { shareEntity } from '@app/features/access-requests/core/types';
import { useAnalytics } from '@app/lib/analytics/analytics-context';
import { useFlow, usePending } from '@app/observability/flow';
import { useIsAuthenticated } from '@core/context/user';
import type { OwnedBlockHandle } from '@core/orchestrator';
import { fireAndForget } from '@core/util/fireAndForget';
import { cacheSessionGeneration } from '@graphql-cache/session-generation';
import { invalidateDocumentLoadBundle } from '@queries/storage/documentLoad/documentLoadBundle';
import { blockNameToItemType } from '@service-storage/client';
import type { AccessLevel as UserAccessLevel } from '@service-storage/generated/schemas/accessLevel';
import { createAsync } from '@solidjs/router';
import { err, ok } from 'neverthrow';
import {
  createEffect,
  createMemo,
  createSignal,
  type JSX,
  onCleanup,
  untrack,
} from 'solid-js';
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
import { trackOpen } from './track-open';

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
  const flow = useFlow();
  usePending(
    'block.publish',
    () => !blockDataSignal.get() && !blockErrorSignal.get()
  );
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
      if (level === null) {
        clearLoadedDocument();
        setError('UNAUTHORIZED');
        return;
      }
      const data = blockDataSignal.get();
      const hasLoadedPermissions =
        data != null && typeof data === 'object' && 'userAccessLevel' in data;
      // Lightweight loaders (e.g. email) supply no permissions. Their initial
      // fallback is not a confirmed access change that requires a remount.
      const accessChanged = hasLoadedPermissions
        ? blockUserAccessSignal.get() !== level
        : previous !== undefined && previous !== level;
      if (
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
  const [publicationRetry, retryPublication] = createSignal(0);
  const loadRequest = createMemo(() => {
    retryToken();
    return {
      source: props.source,
      definition: props.definition,
      id: props.id,
      attempt: 0,
    };
  });
  let loadVersion = 0;
  let disposed = false;

  const getResult = createAsync(async () => {
    publicationRetry();
    const request = loadRequest();
    const version = ++loadVersion;
    const { source, definition, id } = request;
    let generation = cacheSessionGeneration.capture();
    const respond = <R,>(result: R) => ({
      result,
      generation,
      version,
      request,
    });
    const superseded = () =>
      disposed ||
      version !== loadVersion ||
      untrack(currentSharedAccess) === null;
    const stale = () =>
      err([
        { code: 'INVALID' as const, message: 'The loading session changed' },
      ]);
    for (let attempt = request.attempt; attempt < 2; attempt++) {
      request.attempt = attempt;
      if (superseded()) return respond(stale());
      generation = cacheSessionGeneration.capture();
      const result = await untrack(() =>
        loadBlockDataAfterComponentPreload(
          () =>
            flow.task('block.data', async (span) => {
              span.setAttr('block.type', definition.name);
              span.setAttr('document.id', id);
              span.setAttr('block.session_retry', attempt);
              // A retry starts from the document identity, never an old token or URL.
              const origin =
                attempt > 0 && source.type === 'preload'
                  ? source.origin
                  : source;
              const result = await definition.load(origin, 'initial', span);
              if (result.isErr()) span.error('Block data could not load');
              return result;
            }),
          definition.component.preload
        )
      ).catch((error: unknown) => {
        if (cacheSessionGeneration.isCurrent(generation)) throw error;
        return stale();
      });
      if (superseded() || !cacheSessionGeneration.isCurrent(generation)) {
        if (result.isOk() && 'syncSource' in result.value)
          result.value.syncSource.cleanup();
        if (attempt > 0 || superseded()) return respond(stale());
        await cacheSessionGeneration.settled();
        if (superseded() || cacheSessionGeneration.state().paused)
          return respond(stale());
        // This imperative bundle is not an active TanStack query. Its fresh
        // authorization read must not reuse a token cached before retirement.
        await invalidateDocumentLoadBundle(id);
        continue;
      }
      if (result.isErr()) {
        return respond(err(result.error));
      }
      const data = result.value;
      if ('type' in data && data.type === 'preload') {
        console.error(
          `BlockLoader received a nested preload.
Check that the load function does not return a preload source when the intent is not preload`
        );
        return respond(
          err([
            {
              code: 'INVALID' as const,
              message: 'BlockLoader received a nested preload',
            },
          ])
        );
      }
      return respond(
        ok({
          ...data,
          __block: definition.name,
        })
      );
    }
    return respond(stale());
  });

  onCleanup(() => {
    disposed = true;
    loadVersion += 1;
    if (syncSource()) {
      syncSource()!.cleanup();
    }
  });

  createEffect(() => {
    const publication = getResult();
    const result = publication?.result;

    // An earlier in-flight load must not restore a document after revocation.
    if (untrack(currentSharedAccess) === null) {
      if (result?.isOk() && 'syncSource' in result.value)
        result.value.syncSource?.cleanup();
      clearLoadedDocument();
      setError('UNAUTHORIZED');
      return;
    }

    if (
      publication &&
      result?.isOk() &&
      !untrack(() => cacheSessionGeneration.isCurrent(publication.generation))
    ) {
      if ('syncSource' in result.value) result.value.syncSource.cleanup();
      clearLoadedDocument();
      if (publication.request.attempt > 0) {
        setError('INVALID');
        return;
      }
      // Resource delivery is another asynchronous boundary. Keep the original
      // attempt budget when a result is retired after the loader accepted it.
      publication.request.attempt = 1;
      const accepted = publication;
      async function retryAcceptedLoad() {
        await cacheSessionGeneration.settled();
        if (
          disposed ||
          accepted.version !== loadVersion ||
          untrack(currentSharedAccess) === null
        )
          return;
        if (cacheSessionGeneration.state().paused) {
          setError('INVALID');
          return;
        }
        await invalidateDocumentLoadBundle(accepted.request.id);
        if (!disposed && accepted.version === loadVersion)
          retryPublication((value) => value + 1);
      }
      fireAndForget(retryAcceptedLoad(), 'block-loader');
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

    if (!isNested && data) {
      const tracksOpenHistory = props.definition.openTrackingEnabled !== false;
      if (tracksOpenHistory) {
        trackOpen(props.id, data.__block, authenticated);
        analytics.pageView(data.__block);
      }

      if (props.definition.openAnalyticsEnabled ?? tracksOpenHistory)
        analytics.track('open_entity', {
          entityType: data.__block,
          entityId: props.id,
        });
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
