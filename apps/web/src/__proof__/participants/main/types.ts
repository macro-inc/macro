// Copy of main's apps/web/src/lib/queries/channel/types.ts at 8f161035c063cb7d5ffcd1939fbbb0ecaa6612f8, verbatim below the marker
// except the import lines listed in check-copies.sh (paths that main resolved
// relative to its own directory). The proof runner checks this.
// ---- verbatim below ----
import type { ApiChannelParticipant } from '@service-storage/generated/schemas/apiChannelParticipant';

export type ChannelParticipant = ApiChannelParticipant & {
  left_at?: string | null;
};
