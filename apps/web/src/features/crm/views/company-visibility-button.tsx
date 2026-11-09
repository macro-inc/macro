import { Show } from 'solid-js';
import { RecordArchivedStatus } from '../components/record-archived-status';
import { RecordVisibilityAction } from '../components/record-visibility-action';
import { useCrmContext } from '../context/crm-context';
import {
  useCompanyQuery,
  useIsTeamAdmin,
  useSetCompanyHiddenMutation,
} from './use-crm';

export function CompanyVisibilityButton(props: {
  companyId: string;
  grouped?: boolean;
  identity?: boolean;
}) {
  const context = useCrmContext();
  const { company } = useCompanyQuery(() => props.companyId);
  const isAdmin = useIsTeamAdmin();
  const mutation = useSetCompanyHiddenMutation();
  const action = () => (
    <Show when={company()}>
      {(current) => (
        <RecordVisibilityAction
          recordId={current().id}
          kind="company"
          name={current().name}
          hidden={current().hidden}
          grouped={props.grouped}
          canManage={isAdmin()}
          pending={mutation.isPending}
          onChange={(hidden, success, failure) =>
            mutation.mutate(
              { companyId: current().id, hidden },
              {
                onSuccess: () => {
                  success();
                  context.feedback.success(
                    hidden ? 'Company archived' : 'Company restored'
                  );
                },
                onError: () => {
                  failure();
                  context.feedback.failure('Could not update company');
                },
              }
            )
          }
        />
      )}
    </Show>
  );
  return (
    <Show when={company() && !!company()?.hidden === !!props.identity}>
      <Show when={props.identity} fallback={action()}>
        <RecordArchivedStatus kind="company">{action()}</RecordArchivedStatus>
      </Show>
    </Show>
  );
}
