import type { WithNotification } from '@entity/types/notification';
import type { ImportedFrom } from '@service-notification/generated/schemas/importedFrom';
import { match } from 'ts-pattern';
import { getNewestDocumentNotification } from './document-comment-notification';

/** How an imported item's origin reads in the UI ("From Notion"). */
export function importedFromLabel(source: ImportedFrom): string {
  return match(source)
    .with('notion', () => 'From Notion')
    .with('linear', () => 'From Linear')
    .exhaustive();
}

/**
 * Where a Home document row came from, when its newest outstanding event is
 * the import that put it there.
 */
export function getImportedItemSource(
  entity: WithNotification<{
    type: string;
  }>
): ImportedFrom | undefined {
  const metadata = getNewestDocumentNotification(entity)?.notification_metadata;
  return metadata?.tag === 'item_imported'
    ? metadata.content.source
    : undefined;
}
