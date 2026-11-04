import { Show } from 'solid-js';
import { RecordVisibilityAction } from '../components/record-visibility-action';
import { useCrmContext } from '../context/crm-context';
import {
  useContactQuery,
  useIsTeamAdmin,
  useSetContactHiddenMutation,
} from './use-crm';

export function ContactVisibilityButton(props: {
  contactId: string;
  grouped?: boolean;
}) {
  const context = useCrmContext();
  const contactQuery = useContactQuery(() => props.contactId);
  const isTeamAdmin = useIsTeamAdmin();
  const hiddenMutation = useSetContactHiddenMutation();

  return (
    <Show when={contactQuery.data}>
      {(current) => (
        <RecordVisibilityAction
          iconOnly
          grouped={props.grouped}
          recordId={current().id}
          kind="contact"
          name={current().name ?? current().email ?? 'Contact'}
          hidden={current().hidden}
          canManage={isTeamAdmin()}
          pending={hiddenMutation.isPending}
          onChange={(hidden, onSuccess) =>
            hiddenMutation.mutate(
              { contactId: current().id, hidden },
              {
                onSuccess: () => {
                  onSuccess();
                  context.feedback.success(
                    hidden
                      ? 'Person removed from CRM'
                      : 'Person restored to CRM'
                  );
                },
                onError: () =>
                  context.feedback.failure(
                    'Could not update contact visibility'
                  ),
              }
            )
          }
        />
      )}
    </Show>
  );
}
