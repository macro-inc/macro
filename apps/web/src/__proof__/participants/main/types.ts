// Copy of main's apps/web/src/lib/queries/channel/types.ts at 393eee931fa9b40400297c3237ce1ad3e00323d3, verbatim below the marker
// except the import lines listed in check-copies.sh (paths that main resolved
// relative to its own directory). The proof runner checks this.
// ---- verbatim below ----
import type { ApiChannelParticipant } from '@service-storage/client';

export type ChannelParticipant = ApiChannelParticipant & {
  left_at?: string | null;
};
