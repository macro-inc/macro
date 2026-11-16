import type { EventVisibility } from '@service-calendar/generated/schemas/eventVisibility';

/** Explicit metadata changes made by the new composer. Omission preserves old callers. */
export interface ComposerMetadataChanges {
  visibility?: EventVisibility;
  timeZoneChanged?: boolean;
}

export interface ComposerInitialMetadata {
  visibility?: EventVisibility;
  timeZone?: string;
}
