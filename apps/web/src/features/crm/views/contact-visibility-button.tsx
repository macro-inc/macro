import { Button } from '@ui';
import { Show } from 'solid-js';
import { RecordArchivedStatus } from '../components/record-archived-status';
import { RecordVisibilityAction } from '../components/record-visibility-action';
import { useCrmContext } from '../context/crm-context';
import {
  useCompanyQuery,
  useContactQuery,
  useIsTeamAdmin,
  useSetContactHiddenMutation,
} from './use-crm';

export function ContactVisibilityButton(props: {
  contactId: string;
  grouped?: boolean;
  identity?: boolean;
  onOpenCompany?: (companyId: string) => boolean;
}) {
  const context = useCrmContext();
  const contactQuery = useContactQuery(() => props.contactId);
  const parent = useCompanyQuery(() =>
    contactQuery.isSuccess ? (contactQuery.data?.companyId ?? '') : ''
  );
  const hidden = () =>
    !!contactQuery.data?.hidden || !!parent.company()?.hidden;
  const navigation = context.createNavigation();
  const openCompany = () => {
    const id = contactQuery.data?.companyId;
    if (!id || props.onOpenCompany?.(id)) return;
    navigation.openWithSplit({ type: 'company', id }, { activate: true });
  };
  const isTeamAdmin = useIsTeamAdmin();
  const hiddenMutation = useSetContactHiddenMutation();

  const action = () => (
    <Show when={contactQuery.isSuccess ? contactQuery.data : undefined}>
      {(current) => (
        <RecordVisibilityAction
          grouped={props.grouped}
          recordId={current().id}
          kind="contact"
          name={current().name ?? current().email ?? 'Contact'}
          hidden={hidden()}
          parentArchived={parent.company()?.hidden}
          parentPending={
            hidden() &&
            !!current().companyId &&
            (parent.query.isLoading || parent.query.isError)
          }
          onOpenParent={openCompany}
          canManage={isTeamAdmin()}
          pending={hiddenMutation.isPending}
          onChange={(hidden, onSuccess, onError) =>
            hiddenMutation.mutate(
              { contactId: current().id, hidden },
              {
                onSuccess: () => {
                  onSuccess();
                  context.feedback.success(
                    hidden ? 'Person archived' : 'Person restored'
                  );
                },
                onError: () => {
                  onError();
                  context.feedback.failure('Could not update person');
                },
              }
            )
          }
        />
      )}
    </Show>
  );
  return (
    <Show when={contactQuery.isSuccess && hidden() === !!props.identity}>
      <Show when={props.identity} fallback={action()}>
        <RecordArchivedStatus
          kind="contact"
          parentArchived={parent.company()?.hidden}
        >
          {action()}
          <Show when={parent.query.isError}>
            <Button
              variant="link"
              size="sm"
              onClick={() => parent.query.refetch()}
            >
              Retry company check
            </Button>
          </Show>
        </RecordArchivedStatus>
      </Show>
    </Show>
  );
}
