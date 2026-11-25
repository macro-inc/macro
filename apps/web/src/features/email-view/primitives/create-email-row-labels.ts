import type { EmailEntity } from '@entity';
import { shownLabelsOf, useEmailLabelNames } from '@queries/email/label-names';

/**
 * The labels each row of the Mail list shows, from one read of the viewer's
 * labels for the whole list.
 */
export function createEmailRowLabels() {
  const names = useEmailLabelNames();
  return (entity: EmailEntity) => shownLabelsOf(entity.labels ?? [], names());
}
