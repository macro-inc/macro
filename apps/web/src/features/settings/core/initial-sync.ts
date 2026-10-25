import {
  type BackfillJob,
  BackfillJobStatus,
  type Link,
  SyncStatus,
  UserProvider,
} from '@service-email/generated/schemas';
import { match } from 'ts-pattern';

/**
 * Whether an inbox has finished its first full sync. Outlook's sync status
 * comes from its sync streams, so up to date means done. Gmail's also reads up
 * to date when the inbox has no backfill job, so its latest job must be
 * complete too.
 */
export function isInitialSyncComplete(
  link: Pick<Link, 'provider' | 'sync_status'>,
  latestBackfill: Pick<BackfillJob, 'status'> | undefined
): boolean {
  if (link.sync_status !== SyncStatus.UP_TO_DATE) return false;
  return match(link.provider)
    .with(UserProvider.OUTLOOK, () => true)
    .with(
      UserProvider.GMAIL,
      () => latestBackfill?.status === BackfillJobStatus.Complete
    )
    .exhaustive(() => false);
}
