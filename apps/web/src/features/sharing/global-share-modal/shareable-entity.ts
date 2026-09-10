import { ENABLE_EMAIL_SHARING } from '@core/constant/featureFlags';
import type { EntityData } from '@entity';

/** Entity types the global share modal knows how to open. */
export type ShareableEntityType = 'document' | 'chat' | 'project' | 'email';

/** The subset of {@link EntityData} the global share modal accepts. */
export type ShareableEntityData = Extract<
  EntityData,
  { type: ShareableEntityType }
>;

/**
 * Whether an entity type can be shared. Callers use this to decide whether to
 * offer a Share affordance (soup context menu, hotkey) at all; the modal
 * itself still enforces permissions.
 */
export const isShareableEntityType = (
  type: EntityData['type']
): type is ShareableEntityType => {
  // Email threads share through the same modal, which forwards the thread to
  // a channel. Gated by the flag that also gates the email block's Share tool.
  if (type === 'email') return ENABLE_EMAIL_SHARING;
  return type === 'document' || type === 'chat' || type === 'project';
};
