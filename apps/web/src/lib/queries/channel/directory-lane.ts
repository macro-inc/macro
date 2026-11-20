import type { GraphqlSoupInitialInput } from '@service-storage/graphql-soup';

const EXCLUDED_ENTITY_ID = '00000000-0000-0000-0000-000000000000';

/** The channel backfill lane's checkpoint. Renamed from 'channels' when the
 * channel selection gained the directory's fields: a pass completed before
 * then wrote records the directory omits. */
export const CHANNEL_DIRECTORY_CHECKPOINT_ID = 'channel-directory';

/** Every channel the viewer has joined, 100 to a page. The channel backfill
 * lane pages it into the cache; without the cache the directory pages it
 * into memory. */
export const CHANNEL_DIRECTORY_INPUT: GraphqlSoupInitialInput = {
  limit: 100,
  expand: true,
  // A channel's creation time never changes. Activity and views move a
  // channel by updated or viewed time, so a channel the pass has not reached
  // yet could move ahead of its cursor and be skipped.
  sortMethod: 'CREATED_AT',
  emailView: 'ALL',
  filters: {
    calendarEventFilter: { literal: { id: EXCLUDED_ENTITY_ID } },
    documentFilter: { literal: { id: EXCLUDED_ENTITY_ID } },
    projectFilter: { literal: { projectIdSelf: EXCLUDED_ENTITY_ID } },
    chatFilter: { literal: { chatId: EXCLUDED_ENTITY_ID } },
    emailFilter: { tree: { literal: { threadId: EXCLUDED_ENTITY_ID } } },
    channelThreadFilter: { literal: { threadId: EXCLUDED_ENTITY_ID } },
    callFilter: { literal: { callId: EXCLUDED_ENTITY_ID } },
    crmCompanyFilter: { literal: { id: EXCLUDED_ENTITY_ID } },
    foreignEntityFilter: { literal: { id: EXCLUDED_ENTITY_ID } },
  },
};
