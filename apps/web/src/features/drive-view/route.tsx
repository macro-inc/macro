import {
  createSearchParams,
  defineRoute,
  routeParams,
  type SplitRouterEntry,
  useRouteParams,
} from '@app/lib/split-router';
import { callDetailSearch } from '@block-call/call-route';
import { URL_PARAMS as CALL_URL_PARAMS } from '@block-call/constants';
import { URL_PARAMS as MARKDOWN_URL_PARAMS } from '@block-md/constants';
import { URL_PARAMS as PDF_URL_PARAMS } from '@block-pdf/constants';
import { useSplitPanelOrThrow } from '@components/app/split-layout/layoutUtils';
import {
  AppView,
  withAuth,
} from '@components/app/split-layout/split-router/app-route-shell';
import { lazy } from 'solid-js';
import { z } from 'zod';
import { DriveDetailView } from './components/DriveDetailView';
import { DriveView, type DriveViewProps } from './drive-view';
import { driveDetailTrailSchema } from './primitives/drive-detail-trail';
import {
  DRIVE_DOCUMENT_TYPES,
  driveDocumentBlockType,
} from './primitives/drive-route-schema';

const DriveCallDetail = lazy(async () => ({
  default: (await import('./views/DriveCallDetail')).DriveCallDetail,
}));

export const DriveRouteView = withAuth(() => {
  const panel = useSplitPanelOrThrow();
  const props = (): DriveViewProps => {
    const content = panel.handle.content();
    return content.type === 'component'
      ? ((content.params ?? {}) as DriveViewProps)
      : {};
  };
  return (
    <AppView id="documents">
      <DriveView initialFacets={props().initialFacets} />
    </AppView>
  );
});

function DriveCallRouteView() {
  const params = useRouteParams(driveCallRoute);
  const [search] = createSearchParams(callDetailSearch);
  return (
    <DriveCallDetail
      callId={params.callId}
      transcriptId={search.transcriptId}
      seek={search.seek}
    />
  );
}

export const driveCallRoute = defineRoute({
  id: 'drive-call',
  path: 'call/:callId',
  params: z.object({ callId: z.string().min(1) }),
  search: [callDetailSearch.namespace],
  component: DriveCallRouteView,
  remountKey: ({ callId }) => callId,
  claim: ({ callId }) => ({ namespace: 'block', id: `call:${callId}` }),
});
const driveDocumentParams = z.object({
  documentType: z.enum(DRIVE_DOCUMENT_TYPES),
  documentId: z.string().min(1),
});

const documentRemountKey = ({
  documentType,
  documentId,
}: z.infer<typeof driveDocumentParams>) =>
  `${driveDocumentBlockType(documentType)}:${documentId}`;

export const driveRootDocumentRoute = defineRoute({
  id: 'drive-document',
  path: ':documentType/:documentId',
  params: driveDocumentParams,
  state: driveDetailTrailSchema,
  component: DriveDetailView,
  remountKey: documentRemountKey,
  claim: ({ documentType, documentId }) => ({
    namespace: 'block',
    id: `${driveDocumentBlockType(documentType)}:${documentId}`,
  }),
});

export const driveFolderDocumentRoute = defineRoute({
  id: 'drive-folder-document',
  path: ':documentType/:documentId',
  params: driveDocumentParams,
  state: driveDetailTrailSchema,
  component: DriveDetailView,
  remountKey: documentRemountKey,
  claim: ({ documentType, documentId }) => ({
    namespace: 'block',
    id: `${driveDocumentBlockType(documentType)}:${documentId}`,
  }),
});

export const driveTabDocumentRoute = defineRoute({
  id: 'drive-tab-document',
  path: ':documentType/:documentId',
  params: driveDocumentParams,
  state: driveDetailTrailSchema,
  component: DriveDetailView,
  remountKey: documentRemountKey,
  claim: ({ documentType, documentId }) => ({
    namespace: 'block',
    id: `${driveDocumentBlockType(documentType)}:${documentId}`,
  }),
});

export const driveFolderRoute = defineRoute({
  id: 'drive-folder',
  path: 'folder/:folderId?',
  params: z
    .object({ folderId: z.string().min(1).optional() })
    .transform(({ folderId }) => ({
      view: 'folder' as const,
      folderId,
    })),
  state: driveDetailTrailSchema,
  children: [driveFolderDocumentRoute],
});

export const driveTabRoute = defineRoute({
  id: 'drive-tab',
  path: ':tab',
  aliases: ['tab/:tab'],
  params: z.object({ tab: z.enum(['recent', 'shared']) }),
  state: driveDetailTrailSchema,
  children: [driveTabDocumentRoute],
});

export const driveSplitRoute = defineRoute({
  id: 'drive',
  path: 'drive',
  aliases: ['drive/owned', 'drive/tab/owned'],
  component: DriveRouteView,
  search: ['drive'],
  state: driveDetailTrailSchema,
  externalSearch: (entry: Readonly<SplitRouterEntry>) => {
    const type = routeParams<{ documentType?: string }>(
      entry.location.route
    ).documentType;
    if (
      type === 'md' ||
      type === 'task' ||
      type === 'snippet' ||
      type === 'skill'
    ) {
      return Object.values(MARKDOWN_URL_PARAMS);
    }
    if (type === 'pdf') return Object.values(PDF_URL_PARAMS);
    if (
      typeof routeParams<{ callId?: string }>(entry.location.route).callId ===
      'string'
    )
      return [CALL_URL_PARAMS.transcriptId];
    return [];
  },
  children: [
    driveFolderRoute,
    driveTabRoute,
    driveCallRoute,
    driveRootDocumentRoute,
  ],
});
