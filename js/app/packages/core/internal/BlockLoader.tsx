import { type AllTrackingEventValues, withAnalytics } from '@coparse/analytics';
import type { OwnedBlockHandle } from '@core/orchestrator';
import type { AccessLevel as UserAccessLevel } from '@service-storage/generated/schemas/accessLevel';
import { createAsync } from '@solidjs/router';
import { createEffect, type JSX, onCleanup } from 'solid-js';
import {
  type BlockDefinition,
  type BlockName,
  createBlockSignal,
  type FileOrTextLike,
  type LoadFunction,
  NonDocumentBlockTypes,
  useIsNestedBlock,
} from '../block';
import {
  blockEditPermissionEnabledSignal,
  blockErrorSignal,
  blockFileSignal,
  blockHandleSignal,
  blockLoroManagerSignal,
  blockMetadataSignal,
  blockSourceSignal,
  blockSyncSourceSignal,
  blockTextSignal,
  blockUserAccessSignal,
} from '../signal/load';
import type { Source, SourcePreload } from '../source';
import { err, isErr, type ObjectLike, ok } from '../util/maybeResult';

export const blockDataSignal = createBlockSignal<unknown>();
export const blockLiveTrackingEnabledSignal = createBlockSignal<boolean>();
const { track, TrackingEvents } = withAnalytics();

const blockOpenEvents: Partial<Record<BlockName, AllTrackingEventValues>> = {
  canvas: TrackingEvents.BLOCKCANVAS.OPEN,
  md: TrackingEvents.BLOCKMARKDOWN.OPEN,
  code: TrackingEvents.BLOCKCODE.OPEN,
  image: TrackingEvents.BLOCKIMAGE.OPEN,
  pdf: TrackingEvents.BLOCKPDF.OPEN,
  write: TrackingEvents.BLOCKWRITER.OPEN,
  chat: TrackingEvents.BLOCKCHAT.OPEN,
  unknown: TrackingEvents.BLOCKUNKNOWN.OPEN,
  video: TrackingEvents.BLOCKVIDEO.OPEN,
} as const;

export type BlockLoaderProps<
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

  setLiveTrackingEnabled(props.definition.liveTrackingEnabled ?? false);
  setEditPermissionEnabled(props.definition.editPermissionEnabled ?? false);

  const getResult = createAsync(async () => {
    const result = await props.definition.load(props.source, 'initial');
    if (isErr(result)) {
      return result;
    }
    const [, data] = result;
    if ('type' in data && data.type === 'preload') {
      console.error(
        `BlockLoader received a nested preload.
Check that the load function does not return a preload source when the intent is not preload`
      );
      return err('INVALID', 'BlockLoader received a nested preload');
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

    const [, data] = result;
    setError(() => {
      if (isErr(result, 'UNAUTHORIZED')) {
        return 'UNAUTHORIZED';
      } else if (isErr(result, 'MISSING')) {
        return 'MISSING';
      } else if (isErr(result, 'GONE')) {
        return 'GONE';
      } else if (isErr(result)) {
        return 'INVALID';
      }
      return null;
    });

    if (!isNested && data) {
      // NOTE: refetch history causing full page reload so I am disabling it
      if (!NonDocumentBlockTypes.includes(data.__block)) {
        import('./trackAndReload').then(({ trackOpenAndRefetchHistory }) => {
          trackOpenAndRefetchHistory(props.id, false);
        });
      }

      // for analytics
      const blockOpenEvent = blockOpenEvents[data.__block];
      if (blockOpenEvent) {
        track(blockOpenEvent);
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
