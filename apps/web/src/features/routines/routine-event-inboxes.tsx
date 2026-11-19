import { t } from '@app/lib/i18n';
import { useUserId } from '@core/context/user';
import { useEmailLinksQuery } from '@queries/email/link';
import { queryReadyGate } from '@queries/gate';
import { Tooltip } from '@ui';
import { type Accessor, createMemo } from 'solid-js';
import {
  type InboxChoices,
  RoutineInboxPicker as InboxPicker,
  pickedInboxesLabel,
} from './components/routine-inbox-picker';

/**
 * The inboxes the person reads, their own and those shared with them. It
 * never suspends, and keeps the last list on screen when a refetch fails.
 */
function useInboxChoices(): Accessor<InboxChoices> {
  const links = useEmailLinksQuery();
  const userId = useUserId();
  return createMemo((): InboxChoices => {
    if (queryReadyGate(links))
      return {
        state: 'ready',
        inboxes: links.data.links.map((link) => ({
          id: link.id,
          address: link.email_address,
          shared: link.macro_id !== userId(),
        })),
      };
    return links.isPending ? { state: 'pending' } : { state: 'failed' };
  });
}

/** "Your inbox", or "Your inboxes" once the person reads more than one. */
export function InboxScopeLabel() {
  const choices = useInboxChoices();
  const label = () => {
    const value = choices();
    // No inboxes, or none listed yet, still reads "Your inbox".
    return t('routineFilters.yourInboxes', {
      count: value.state === 'ready' ? Math.max(value.inboxes.length, 1) : 1,
    });
  };
  return <span>{label()}</span>;
}

/** "team@example.com", or "2 inboxes". */
export function RoutineInboxesLabel(props: { inboxes: string[] }) {
  const choices = useInboxChoices();
  const label = () => pickedInboxesLabel(props.inboxes, choices());
  return (
    <Tooltip label={label()} as="span" class="min-w-0">
      <span class="truncate">{label()}</span>
    </Tooltip>
  );
}

/** The person's inboxes to check for an email trigger. */
export function RoutineInboxPicker(props: {
  inboxes: Accessor<string[]>;
  onChange: (inboxes: string[]) => void;
}) {
  const choices = useInboxChoices();
  return (
    <InboxPicker
      choices={choices()}
      picked={props.inboxes}
      onChange={props.onChange}
    />
  );
}
