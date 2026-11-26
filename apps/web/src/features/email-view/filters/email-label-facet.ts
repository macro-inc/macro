import { clause, type FacetOption } from '@app/features/soup';
import type { EmailEntity } from '@entity';

/** The facet Mail stores its selected label ids under. */
export const LABEL_FACET_ID = 'labels';

/**
 * A selected Gmail label or Outlook category, as a server clause and a check
 * on a loaded row. Both see only the labels of inboxes the viewer owns or
 * manages, so a shared thread never matches its owner's labels.
 */
export function labelFacetOption<TContext>(
  labelId: string
): FacetOption<EmailEntity, TContext> {
  return {
    id: labelId,
    clause: { ef: clause.eq('emailLabel', labelId) },
    predicate: (email) =>
      email.labels?.some((label) => label.id === labelId) ?? false,
  };
}
