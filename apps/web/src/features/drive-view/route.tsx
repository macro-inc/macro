import {
  defineRoute,
  routeParams,
  type SplitRouterEntry,
} from '@app/lib/split-router';
import { URL_PARAMS as MARKDOWN_URL_PARAMS } from '@block-md/constants';
import { URL_PARAMS as PDF_URL_PARAMS } from '@block-pdf/constants';
import { useSplitPanelOrThrow } from '@components/app/split-layout/layoutUtils';
import {
  NewAppView,
  withAuth,
} from '@components/app/split-layout/split-router/app-route-shell';
import { useUserContext } from '@core/context/user';
import { lazy } from 'solid-js';
import { z } from 'zod';
import { queryStateFrom } from '../next-soup/filters/filter-store';
import type { SetPredicatesInput } from '../next-soup/filters/filter-store/predicates-store';
import { mergeQuery } from '../next-soup/filters/filter-store/query-store';
import type { Query } from '../next-soup/filters/filter-store/types';
import { getViewPreset } from '../next-soup/sidebar/soup-filter-presets';
import type { DriveViewProps } from './drive-view';
import {
  DRIVE_DOCUMENT_TYPES,
  driveDocumentBlockType,
} from './primitives/drive-route-schema';

const SoupView = lazy(async () => ({
  default: (await import('../next-soup/soup-view/soup-view')).SoupView,
}));
const DriveView = lazy(async () => ({
  default: (await import('./drive-view')).DriveView,
}));
const DriveDetailView = lazy(async () => ({
  default: (await import('./components/DriveDetailView')).DriveDetailView,
}));

type DriveRouteViewProps = DriveViewProps & {
  initialFilters?: Query;
  initialClientFilters?: SetPredicatesInput<string>;
};

export const DriveRouteView = withAuth(() => {
  const panel = useSplitPanelOrThrow();
  const props = (): DriveRouteViewProps => {
    const content = panel.handle.content();
    return content.type === 'component'
      ? ((content.params ?? {}) as DriveRouteViewProps)
      : {};
  };
  const user = useUserContext();
  const preset = getViewPreset('documents', undefined, {
    userId: user.userId(),
    isTeamAdmin: false,
  });
  const initialFilters = () => {
    const requested = props().initialFilters;
    return preset?.filters && requested
      ? mergeQuery(queryStateFrom(preset.filters), requested)
      : (requested ?? preset?.filters);
  };
  const initialClientFilters = () =>
    preset?.clientFilters && props().initialClientFilters
      ? {
          and: [
            ...new Set([
              ...(preset.clientFilters.and ?? []),
              ...(props().initialClientFilters?.and ?? []),
            ]),
          ],
          or: [
            ...new Set([
              ...(preset.clientFilters.or ?? []),
              ...(props().initialClientFilters?.or ?? []),
            ]),
          ],
        }
      : (props().initialClientFilters ?? preset?.clientFilters);
  return (
    <NewAppView
      id="documents"
      composableOnTouch
      fallback={
        <SoupView
          viewName="Files"
          initialFilters={initialFilters()}
          initialClientFilters={initialClientFilters()}
          initialGroupBy={preset?.groupBy}
        />
      }
    >
      <DriveView initialFacets={props().initialFacets} />
    </NewAppView>
  );
});

const driveDocumentParams = z.object({
  documentType: z.enum(DRIVE_DOCUMENT_TYPES),
  documentId: z.string().min(1),
});

export const driveRootDocumentRoute = defineRoute({
  id: 'drive-document',
  path: ':documentType/:documentId',
  params: driveDocumentParams,
  component: DriveDetailView,
  claim: ({ documentType, documentId }) => ({
    namespace: 'block',
    id: `${driveDocumentBlockType(documentType)}:${documentId}`,
  }),
});

export const driveFolderDocumentRoute = defineRoute({
  id: 'drive-folder-document',
  path: ':documentType/:documentId',
  params: driveDocumentParams,
  component: DriveDetailView,
  claim: ({ documentType, documentId }) => ({
    namespace: 'block',
    id: `${driveDocumentBlockType(documentType)}:${documentId}`,
  }),
});

export const driveTabDocumentRoute = defineRoute({
  id: 'drive-tab-document',
  path: ':documentType/:documentId',
  params: driveDocumentParams,
  component: DriveDetailView,
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
    .transform(({ folderId }) => ({ view: 'folder' as const, folderId })),
  children: [driveFolderDocumentRoute],
});

export const driveTabRoute = defineRoute({
  id: 'drive-tab',
  path: ':tab',
  aliases: ['tab/:tab'],
  params: z.object({ tab: z.enum(['recent', 'shared']) }),
  children: [driveTabDocumentRoute],
});

export const driveSplitRoute = defineRoute({
  id: 'drive',
  path: 'drive',
  aliases: ['drive/owned', 'drive/tab/owned'],
  component: DriveRouteView,
  search: ['drive'],
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
    return type === 'pdf' ? Object.values(PDF_URL_PARAMS) : [];
  },
  children: [driveFolderRoute, driveTabRoute, driveRootDocumentRoute],
});
