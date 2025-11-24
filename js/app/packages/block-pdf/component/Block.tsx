import './block.css';

import {
  type LocationBlockParams,
  locationChangedSignal,
  pendingLocationParamsSignal,
} from '@block-pdf/signal/location';
import { showTabBarSignal } from '@block-pdf/signal/placeables';
import { withAnalytics } from '@coparse/analytics';
import { useIsNestedBlock } from '@core/block';
import { DocumentBlockContainer } from '@core/component/DocumentBlockContainer';
import { blockHandleSignal, blockMetadataSignal } from '@core/signal/load';
import { createCallback } from '@solid-primitives/rootless';
import { debounce, leading } from '@solid-primitives/scheduled';
import { type BeforeLeaveEventArgs, useBeforeLeave } from '@solidjs/router';
import { createMethodRegistration } from 'core/orchestrator';
import {
  createEffect,
  createResource,
  onCleanup,
  onMount,
  Show,
} from 'solid-js';
import { reconcile } from 'solid-js/store';
import { fromZodError } from 'zod-validation-error';
import { keyedTermDataStore } from '../PdfViewer/TermDataStore';
import {
  pdfDocumentProxy,
  pdfModificationDataStore,
  pdfOverlays,
  pdfViewLocation,
} from '../signal/document';
import { pdfBlockDataSignal } from '../signal/pdfBlockData';
import {
  isSaving as isSavingSignal,
  serverModificationDataSignal,
  usePdfSave,
} from '../signal/save';
import { useUpdateColorsEffect } from '../signal/setting';
import { useTableOfContentsUpdate } from '../store/tableOfContents';
import {
  IModificationDataOnServerSchema,
  transformModificationDataToClient,
} from '../type/coParse';
import { preprocess } from '../websocket/preprocess';
import { Document } from './Document';
import { Tabs } from './Tabs';
import { TopBar } from './TopBar';

const { track, TrackingEvents } = withAnalytics();

function onKeyPress(e: KeyboardEvent) {
  if (
    (e.key.toLowerCase() === 's' || e.key === 'z') &&
    // TODO: This is deprecated be careful of updates as this may break
    (navigator.platform.includes('Mac') ? e.metaKey : e.ctrlKey)
  ) {
    e.preventDefault();
  }
  if (
    e.key === 'p' &&
    (navigator.platform.includes('Mac') ? e.metaKey : e.ctrlKey)
  ) {
    e.preventDefault();
  }
}

export default function BlockPdf() {
  const isNestedBlock = useIsNestedBlock();
  const showTabBar = showTabBarSignal.get;

  const setPdfDocumentProxy = pdfDocumentProxy.set;
  const setPdfViewLocation = pdfViewLocation.set;

  const setPdfModificationData = pdfModificationDataStore.set;
  const setServerModificationData = serverModificationDataSignal.set;

  createEffect(async () => {
    const blockData = pdfBlockDataSignal();
    if (!blockData) return;

    setPdfDocumentProxy(blockData.documentProxy);
    setPdfViewLocation(isNestedBlock ? undefined : blockData.viewLocation);

    if (
      window.location.pathname !== '/app' &&
      window.location.pathname !== '/app/'
    )
      track(TrackingEvents.BLOCKPDF.OPEN);

    const modificationData = blockData.documentMetadata.modificationData;
    if (!modificationData) return;

    const parsedModificationData =
      IModificationDataOnServerSchema.safeParse(modificationData);
    if (parsedModificationData.success) {
      const serverModificationData = parsedModificationData.data;
      setServerModificationData(serverModificationData);

      const transformedModificationData = transformModificationDataToClient(
        serverModificationData
      );
      setPdfModificationData(reconcile(transformedModificationData));
    } else {
      console.error(
        'Failed to parse modification data',
        fromZodError(parsedModificationData.error)
      );
    }
  });

  const [preprocessResource] = createResource(() => {
    const metadata = blockMetadataSignal();
    if (!metadata) return;
    const { documentId, documentVersionId } = metadata;

    return { documentId, documentVersionId };
  }, preprocess);
  const tableOfContentsDispatch = useTableOfContentsUpdate();
  const setPdfOverlays = pdfOverlays.set;
  createEffect(() => {
    const error = preprocessResource.error;
    if (error) return;

    const coparse = preprocessResource.latest;
    if (!coparse) return;

    const store = keyedTermDataStore();
    store?.load(coparse.defs ?? '');
    tableOfContentsDispatch({ type: 'LOAD_AI_TOC', coparse });
    setPdfOverlays(coparse.overlays);
  });

  const savePdf = usePdfSave();
  // use before leave is being called twice
  const debouncedSave = leading(
    debounce,
    (e: BeforeLeaveEventArgs) => {
      e.preventDefault();
      savePdf().then(() => e.retry(true));
    },
    500
  );

  useBeforeLeave((e) => {
    if (isNestedBlock) return;
    debouncedSave(e);
  });

  const isSaving = isSavingSignal.get;
  let beforeUnloadHandler = (e: Event) => {
    if (isNestedBlock) return;
    if (isSaving()) {
      e.preventDefault();
    }
  };

  // used to keep the appearance color synced across tabs
  useUpdateColorsEffect();

  onMount(() => {
    if (isNestedBlock) return;
    window.addEventListener('keydown', onKeyPress);
    window.addEventListener('beforeunload', beforeUnloadHandler);
    onCleanup(() => {
      window.removeEventListener('keydown', onKeyPress);
      window.removeEventListener('beforeunload', beforeUnloadHandler);
    });
  });
  const blockHandle = blockHandleSignal.get;

  const setPendingLocationParamsSignal = pendingLocationParamsSignal.set;
  const setLocationChanged = locationChangedSignal.set;
  const goToLocationFromParams = createCallback(
    (params: LocationBlockParams) => {
      console.log('GO TO LOCATION FROM PARAMS', params);

      setLocationChanged(true);

      // Note: structuredClone was failing here due to proxy nonsense.
      setPendingLocationParamsSignal(JSON.parse(JSON.stringify(params)));
    }
  );

  createMethodRegistration(blockHandle, {
    goToLocationFromParams: async (params: LocationBlockParams) =>
      goToLocationFromParams(params),
  });

  return (
    <DocumentBlockContainer>
      <div
        class="w-full h-full bg-panel select-none overscroll-none overflow-hidden flex flex-col"
        onContextMenu={(e) => e.preventDefault()}
        data-tut="App"
      >
        <Show when={!isNestedBlock}>
          <TopBar />
          <Show when={showTabBar()}>
            <div class="flex px-2 justify-between min-h-11 items-center gap-2">
              <div
                class={`overflow-x-auto overflow-y-hidden grow customScrollbar w-0`}
              >
                <Tabs />
              </div>
            </div>
          </Show>
        </Show>
        <div
          class="flex h-full w-full relative justify-end overflow-visible z-main-view-layout"
          id="main-view"
        >
          {/* {ENABLE_VIEWER_SIDE_PANEL && <ViewerNavStack />} */}
          <Document />
          {/* <CustomCursor /> */}
        </div>
      </div>
    </DocumentBlockContainer>
  );
}
