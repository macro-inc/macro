import { useFeatureFlag } from '@app/lib/analytics/posthog';
import { enableEmailReadReceipts } from '@core/constant/featureFlags';
import { useEmailLinksQuery } from '@queries/email/link';
import { useThreadReadReceiptsQuery } from '@queries/email/read-receipts';
import { queryReadyGate } from '@queries/gate';
import type { Accessor } from 'solid-js';
import type { EmailMessage } from '../email-message/core/email-message';
import type { ReadReceipt } from '../email-message/core/read-receipt';

/** Looks up opens for the viewer's tracked messages. Never suspends: the
 * thread renders without receipts until they load. */
export function createThreadReadReceipts(threadId: Accessor<string>) {
  const flag = useFeatureFlag(enableEmailReadReceipts);
  const links = useEmailLinksQuery();
  const tracking = () =>
    flag().enabled &&
    queryReadyGate(links) &&
    links.data.links.some((link) => link.settings.read_receipts_enabled);
  const query = useThreadReadReceiptsQuery(threadId, tracking);
  return (message: EmailMessage): ReadReceipt | undefined => {
    if (!tracking() || !queryReadyGate(query)) return undefined;
    const receipt = query.data[message.db_id];
    if (!receipt) return undefined;
    return {
      openCount: receipt.open_count,
      firstOpenedAt: receipt.first_opened_at ?? undefined,
      lastOpenedAt: receipt.last_opened_at ?? undefined,
    };
  };
}
