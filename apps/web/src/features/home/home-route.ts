import type { CalendarPeriodView } from '@app/features/calendar/types';
import { calendarViewContent } from '@app/features/calendar-view/calendar-navigation';
import {
  type CalendarSearchParams,
  calendarSearchTarget,
} from '@app/features/calendar-view/calendar-url';
import type { channelsSearch } from '@app/features/channels-view/channels-route';
import type { DriveSearchParams } from '@app/features/drive-view/primitives/drive-search';
import { URL_PARAMS as CHANNEL_URL_PARAMS } from '@block-channel/constants';
import type { PreviewBlockTarget } from '@components/app/previewTarget';
import type { SplitContent } from '@components/app/split-layout/layoutManager';
import { isBlockAlias, resolveBlockAlias } from '@core/constant/allBlocks';
import { documentCommentLocation } from '@notifications/document-comment-location';
import type { z } from 'zod';
import { projectHostedContent } from '../projects/open-project';
import {
  type HomePreviewRouteParams,
  type homeProjectSearch,
  isHomeDocumentType,
} from './home-route-schema';

export type HomePreviewSearch = {
  channel: Pick<
    z.infer<typeof channelsSearch.schema>,
    'messageId' | 'threadId'
  >;
  document: Pick<DriveSearchParams, 'commentId'>;
  project?: z.infer<typeof homeProjectSearch.schema>;
};

/** Normalize typed and fallback child routes to the same block identity. */
export function homeDetailParamsFromRoute(params: {
  blockType?: HomePreviewRouteParams['blockType'];
  previewId?: string;
  channelId?: string;
  documentType?: string;
  documentId?: string;
}): HomePreviewRouteParams | undefined {
  if (params.channelId) {
    return { blockType: 'channel', previewId: params.channelId };
  }
  if (
    params.documentType &&
    params.documentId &&
    isHomeDocumentType(params.documentType)
  ) {
    return {
      blockType: params.documentType,
      previewId: params.documentId,
    };
  }
  if (params.blockType && params.previewId) {
    return { blockType: params.blockType, previewId: params.previewId };
  }
}

function channelParams(
  search: HomePreviewSearch['channel']
): Record<string, string> | undefined {
  if (!search.messageId) return;
  return {
    [CHANNEL_URL_PARAMS.message]: search.messageId,
    ...(search.threadId
      ? { [CHANNEL_URL_PARAMS.thread]: search.threadId }
      : {}),
  };
}

function commentParams(
  blockType: HomePreviewRouteParams['blockType'],
  search: HomePreviewSearch['document']
): Record<string, string> | undefined {
  if (!search.commentId) return;
  const alias = isBlockAlias(blockType) ? blockType : undefined;
  return documentCommentLocation(search.commentId, {
    fileType: resolveBlockAlias(blockType),
    subType: alias ? { type: alias } : undefined,
  }).params;
}

/** The block the path names, with the location params the URL carries for it. */
export function homePreviewTarget(
  params: HomePreviewRouteParams,
  search: HomePreviewSearch
): PreviewBlockTarget {
  const blockType = resolveBlockAlias(params.blockType);
  return {
    blockType,
    blockId: params.previewId,
    aliasContext: isBlockAlias(params.blockType)
      ? { alias: params.blockType, baseType: blockType }
      : undefined,
    params:
      blockType === 'initiative'
        ? {
            section: search.project?.section ?? 'overview',
            discussionId: search.project?.discussionId,
          }
        : blockType === 'channel'
          ? channelParams(search.channel)
          : commentParams(params.blockType, search.document),
  };
}

/** Full-block compatibility content for touch surfaces. */
export function homePreviewLegacyTarget(
  params: HomePreviewRouteParams,
  search: HomePreviewSearch
): SplitContent {
  if (params.blockType === 'initiative') {
    return projectHostedContent(
      params.previewId,
      search.project?.section ?? 'overview',
      search.project?.discussionId
    );
  }
  const target = homePreviewTarget(params, search);
  return {
    type: params.blockType,
    id: params.previewId,
    ...(target.params ? { params: target.params } : {}),
  };
}

/** Calendar view content for touch surfaces, from the inline calendar route's period and search. */
export function homeCalendarLegacyTarget(
  period: CalendarPeriodView,
  search: CalendarSearchParams
): SplitContent {
  return calendarViewContent({ ...calendarSearchTarget(search), period });
}
