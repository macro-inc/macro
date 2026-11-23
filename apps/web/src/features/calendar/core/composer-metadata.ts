import type { EventTransparency } from '@service-calendar/generated/schemas/eventTransparency';
import type { EventVisibility } from '@service-calendar/generated/schemas/eventVisibility';

/** Explicit metadata changes made by the new composer. Omission preserves old callers. */
export interface ComposerMetadataChanges {
  visibility?: EventVisibility;
  transparency?: EventTransparency;
  timeZoneChanged?: boolean;
}

export interface ComposerInitialMetadata {
  visibility?: EventVisibility;
  transparency?: EventTransparency;
  timeZone?: string;
}
