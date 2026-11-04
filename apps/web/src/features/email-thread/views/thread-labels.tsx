import { EmailLabelPills } from '@app/features/entity/components/EmailLabelPills';
import { useShownEmailLabelNamesQuery } from '@queries/email/labels';
import { createMemo } from 'solid-js';
import type { EmailMessage } from '../../email-message/core/email-message';

/** The provider labels on any of the thread's messages, as the list row shows them. */
export function ThreadLabels(props: { messages: readonly EmailMessage[] }) {
  const shownNames = useShownEmailLabelNamesQuery();
  const names = createMemo(() => {
    const shown = shownNames.data;
    if (!shown) return [];
    const onThread = new Set<string>();
    for (const message of props.messages) {
      for (const label of message.labels) {
        if (label.name && shown.has(label.name)) onThread.add(label.name);
      }
    }
    return [...onThread].sort((a, b) => a.localeCompare(b));
  });
  return <EmailLabelPills names={names()} pillClass="bg-surface-2" />;
}
