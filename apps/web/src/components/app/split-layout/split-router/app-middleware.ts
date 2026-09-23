import { getPreferredCalendarPeriodView } from '@app/features/calendar/calendar-preferences';
import {
  CALENDAR_ROUTE_ID,
  CALENDAR_SEARCH_NAMESPACE,
  calendarPath,
} from '@app/features/calendar-view/calendar-url';
import { CALENDAR_VIEW_ID } from '@app/features/calendar-view/types';
import { CHANNEL_DETAIL_SEARCH_NAMESPACE } from '@app/features/channels-view/channels-route';
import {
  driveDocumentFromContent,
  drivePath,
} from '@app/features/drive-view/primitives/drive-route';
import { driveDocumentBlockType } from '@app/features/drive-view/primitives/drive-route-schema';
import { URL_PARAMS as EMAIL_URL_PARAMS } from '@app/features/email-thread/core/location';
import { EMAIL_DETAIL_SEARCH_NAMESPACE } from '@app/features/email-view/email-route';
import {
  routeParams,
  type SerializedSearchParams,
  type SplitRouterMiddleware,
} from '@app/lib/split-router';
import { replaceSplitSearchParams } from '@app/lib/split-router/search';
import { URL_PARAMS as CHANNEL_URL_PARAMS } from '@block-channel/constants';
import { appSplitRoutes } from './app-routes';
import { decodeLegacyPair } from './legacy-route';

type NewAppViewsState = {
  enabled: boolean;
  loading: boolean;
};

export function createAppSplitRouterMiddleware(options: {
  newAppViews: () => NewAppViewsState;
  isTouchDevice: () => boolean;
}): readonly SplitRouterMiddleware[] {
  return [
    ({ to, redirect }) => {
      if (
        to.location.route.matches[0].id === 'drive' &&
        options.isTouchDevice()
      ) {
        const params = routeParams(to.location.route);
        if (
          typeof params.documentType === 'string' &&
          typeof params.documentId === 'string'
        ) {
          return redirect(
            `/${driveDocumentBlockType(params.documentType)}/${encodeURIComponent(params.documentId)}`
          );
        }
      }
      if (to.location.route.matches[0].id !== 'legacy-content') return;
      const params = routeParams(to.location.route);
      const type = typeof params.type === 'string' ? params.type : undefined;
      const id = typeof params.id === 'string' ? params.id : undefined;
      if (type === 'component' && id) {
        if (id === 'preview-empty' || id === 'non-member-channel')
          return redirect('/inbox');
        if (id === 'documents') return redirect('/drive');
        if (id === 'settings') return redirect('/settings');
        if (id === CALENDAR_VIEW_ID) {
          return redirect(calendarPath(getPreferredCalendarPeriodView()));
        }
        if (
          appSplitRoutes.definitions.some((route) => route.id === `view-${id}`)
        ) {
          return redirect(`/${id}`);
        }
      }

      const content = type && id ? decodeLegacyPair(type, id) : undefined;
      if (!content) return;
      if (content.type === 'component' && content.id === CALENDAR_VIEW_ID) {
        return redirect(calendarPath(getPreferredCalendarPeriodView()));
      }
      const flag = options.newAppViews();
      const canRenderDetail =
        !flag.loading && flag.enabled && !options.isTouchDevice();
      if (!canRenderDetail) return;

      if (content.type === 'email') {
        return redirect(`/mail/${encodeURIComponent(content.id)}`);
      }
      if (content.type === 'channel') {
        return redirect(`/channels/${encodeURIComponent(content.id)}`);
      }
      if (type === 'task') {
        return redirect(`/tasks/${encodeURIComponent(content.id)}`);
      }

      const document = driveDocumentFromContent(content);
      if (!document) return;
      return redirect(drivePath({ kind: 'tab', tab: 'owned' }, document));
    },
    ({ to, path, cause, externalSearch, redirect }) => {
      if (cause !== 'initial' && cause !== 'external') return;
      if (!externalSearch) return;

      const leafId = to.location.route.matches.at(-1)?.id;
      let namespace: string;
      let fields: [string, string][];
      if (leafId === 'mail-thread') {
        namespace = EMAIL_DETAIL_SEARCH_NAMESPACE;
        fields = [[EMAIL_URL_PARAMS.messageId, 'messageId']];
      } else if (leafId === 'channels-channel') {
        namespace = CHANNEL_DETAIL_SEARCH_NAMESPACE;
        fields = [
          [CHANNEL_URL_PARAMS.message, 'messageId'],
          [CHANNEL_URL_PARAMS.thread, 'threadId'],
        ];
      } else if (leafId === CALENDAR_ROUTE_ID) {
        namespace = CALENDAR_SEARCH_NAMESPACE;
        fields = [['eventId', 'eventId']];
      } else {
        return;
      }

      const raw = new URLSearchParams(externalSearch);
      const current = to.location.search?.[namespace] ?? {};
      const additions: SerializedSearchParams = {};
      for (const [legacyKey, field] of fields) {
        // Explicit canonical values, including empty ones, take precedence.
        if (Object.hasOwn(current, field)) continue;
        const values = raw.getAll(legacyKey);
        if (values.length) additions[field] = values;
      }
      if (!Object.keys(additions).length) return;

      const search = {
        ...to.location.search,
        [namespace]: { ...current, ...additions },
      };
      const query = new URLSearchParams();
      // Middleware redirects describe one entry; the router assigns its pane index.
      replaceSplitSearchParams(query, [{ location: { search } }]);
      return redirect(`${path}?${query}`);
    },
  ];
}
