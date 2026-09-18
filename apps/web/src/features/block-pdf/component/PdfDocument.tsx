import './block.css';

import type { PortalScope } from '@core/component/ScopedPortal';
import type { GetDocumentResponseDataViewLocation } from '@service-storage/generated/schemas/getDocumentResponseDataViewLocation';
import { debounce, leading } from '@solid-primitives/scheduled';
import { type BeforeLeaveEventArgs, useBeforeLeave } from '@solidjs/router';
import type { PDFDocumentProxy } from 'pdfjs-dist/types/src/display/api';
import {
  createEffect,
  createResource,
  type JSX,
  onCleanup,
  onMount,
  Show,
} from 'solid-js';
import { reconcile } from 'solid-js/store';
import { fromZodError } from 'zod-validation-error';
import {
  type PdfDocumentPermissions,
  PdfDocumentProvider,
  usePdfDocument,
} from '../context/pdf-document-context';
import {
  type LocationBlockParams,
  type LocationSearchParams,
  usePendingLocationNavigationEffect,
} from '../signal/location';
import { usePdfSave } from '../signal/save';
import { useUpdateColorsEffect } from '../signal/setting';
import { useSyncHighlightStore } from '../store/highlight';
import { useSyncActivePlaceableWithCommentThread } from '../store/placeables';
import { useTableOfContentsUpdate } from '../store/tableOfContents';
import {
  IModificationDataOnServerSchema,
  transformModificationDataToClient,
} from '../type/coParse';
import { preprocess } from '../websocket/preprocess';
import { Document } from './Document';

function preventNativePdfShortcuts(event: KeyboardEvent) {
  if (
    (event.key.toLowerCase() === 's' || event.key === 'z') &&
    (navigator.platform.includes('Mac') ? event.metaKey : event.ctrlKey)
  ) {
    event.preventDefault();
  }
  if (
    event.key === 'p' &&
    (navigator.platform.includes('Mac') ? event.metaKey : event.ctrlKey)
  ) {
    event.preventDefault();
  }
}

export type PdfDocumentMethods = {
  goToLocationFromParams: (params: LocationBlockParams) => Promise<void>;
};

export type PdfDocumentProps = {
  documentId: string;
  documentVersionId?: number;
  documentName: string;
  documentProxy?: PDFDocumentProxy;
  viewLocation?: GetDocumentResponseDataViewLocation;
  modificationData?: unknown;
  isNested?: boolean;
  hotkeyScope: string;
  portalScope?: PortalScope;
  permissions: PdfDocumentPermissions;
  locationParams?: LocationSearchParams;
  registerMethods?: (methods: Partial<PdfDocumentMethods>) => void;
  children: JSX.Element;
};

export function PdfDocument(props: PdfDocumentProps) {
  return (
    <Show when={props.documentId} keyed>
      {(documentId) => (
        <PdfDocumentProvider
          documentId={documentId}
          documentVersionId={props.documentVersionId}
          documentName={props.documentName}
          isNested={props.isNested}
          hotkeyScope={props.hotkeyScope}
          portalScope={props.portalScope}
          permissions={props.permissions}
          locationParams={props.locationParams}
        >
          <PdfDocumentState {...props} />
        </PdfDocumentProvider>
      )}
    </Show>
  );
}

export function PdfDocumentContent() {
  return (
    <div class="flex size-full relative justify-end overflow-visible z-main-view-layout">
      <Document />
    </div>
  );
}

function PdfDocumentState(props: PdfDocumentProps) {
  const pdf = usePdfDocument();
  usePendingLocationNavigationEffect();
  useSyncHighlightStore();
  useSyncActivePlaceableWithCommentThread();
  const {
    documentProxy,
    viewLocation,
    pendingLocationParams,
    locationChanged,
    serverModificationData,
    isSaving,
  } = pdf.state.signals;
  const [, setModificationData] = pdf.state.stores.modificationData;
  const tableOfContentsDispatch = useTableOfContentsUpdate();
  const savePdf = usePdfSave();

  props.registerMethods?.({
    goToLocationFromParams: async (params) => {
      locationChanged[1](true);
      pendingLocationParams[1](JSON.parse(JSON.stringify(params)));
    },
  });

  createEffect(() => {
    documentProxy[1](props.documentProxy);
    viewLocation[1](pdf.isNested() ? undefined : props.viewLocation);

    const modificationData = props.modificationData;
    if (!modificationData) return;
    const parsed = IModificationDataOnServerSchema.safeParse(modificationData);
    if (!parsed.success) {
      console.error(
        'Failed to parse modification data',
        fromZodError(parsed.error)
      );
      return;
    }

    serverModificationData[1](parsed.data);
    setModificationData(
      reconcile(transformModificationDataToClient(parsed.data))
    );
  });

  const [preprocessResource] = createResource(() => {
    const documentVersionId = pdf.documentVersionId();
    if (!documentVersionId) return;
    return {
      documentId: pdf.documentId(),
      documentVersionId,
    };
  }, preprocess);

  createEffect(() => {
    if (preprocessResource.error) return;
    const coparse = preprocessResource.latest;
    if (!coparse) return;

    pdf.state.termDataStore.load(coparse.defs ?? '');
    tableOfContentsDispatch({ type: 'LOAD_AI_TOC', coparse });
    pdf.state.signals.overlays[1](coparse.overlays);
  });

  const debouncedSave = leading(
    debounce,
    (event: BeforeLeaveEventArgs) => {
      event.preventDefault();
      void savePdf().then(() => event.retry(true));
    },
    500
  );
  useBeforeLeave((event) => {
    if (!pdf.isNested()) debouncedSave(event);
  });

  useUpdateColorsEffect();

  onMount(() => {
    if (pdf.isNested()) return;
    const handleBeforeUnload = (event: Event) => {
      if (isSaving[0]()) event.preventDefault();
    };
    window.addEventListener('keydown', preventNativePdfShortcuts);
    window.addEventListener('beforeunload', handleBeforeUnload);
    onCleanup(() => {
      window.removeEventListener('keydown', preventNativePdfShortcuts);
      window.removeEventListener('beforeunload', handleBeforeUnload);
    });
  });

  return (
    <div
      ref={pdf.setRootElement}
      class="size-full select-none overscroll-none overflow-hidden flex flex-col"
      onContextMenu={(event) => event.preventDefault()}
      data-tut="App"
    >
      {props.children}
    </div>
  );
}
