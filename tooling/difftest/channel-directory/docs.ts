// The documents the web app sends for the channel lane on main and on the
// branch, as the transport sends them (cache-only directives removed), and the
// lane's input, copied from CHANNEL_SOUP_BACKFILL_LANE (the same on both).
import { type DocumentNode, print, visit } from 'graphql';
import { SoupBackfillDocument as MainLaneDocument } from './before-graphql';
import {
  ChannelDirectoryPageDocument,
  SoupChannelDirectoryBackfillDocument,
} from '../../../apps/web/src/lib/service-clients/service-storage/graphql/generated/graphql';

function transportText(document: unknown): string {
  return print(
    visit(document as DocumentNode, {
      Directive(node) {
        return node.name.value === 'cacheOnly' ? null : undefined;
      },
    })
  );
}

export const MAIN_LANE = transportText(MainLaneDocument);
export const BRANCH_LANE = transportText(SoupChannelDirectoryBackfillDocument);
export const DIRECTORY_PAGE = transportText(ChannelDirectoryPageDocument);

const EXCLUDED = '00000000-0000-0000-0000-000000000000';
export const LANE_INPUT = {
  limit: 100,
  expand: true,
  sortMethod: 'VIEWED_UPDATED',
  emailView: 'ALL',
  filters: {
    calendarEventFilter: { literal: { id: EXCLUDED } },
    documentFilter: { literal: { id: EXCLUDED } },
    projectFilter: { literal: { projectIdSelf: EXCLUDED } },
    chatFilter: { literal: { chatId: EXCLUDED } },
    emailFilter: { tree: { literal: { threadId: EXCLUDED } } },
    channelThreadFilter: { literal: { threadId: EXCLUDED } },
    callFilter: { literal: { callId: EXCLUDED } },
    crmCompanyFilter: { literal: { id: EXCLUDED } },
    foreignEntityFilter: { literal: { id: EXCLUDED } },
  },
};

export function pageInput(cursor: string | null) {
  return cursor
    ? { continuation: { cursor, expand: true, emailView: 'ALL' } }
    : { initial: LANE_INPUT };
}
