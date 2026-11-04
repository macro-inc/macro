import { toast } from '@core/component/Toast/Toast';
import { fireAndForget } from '@core/util/fireAndForget';
import type { CrmCompanyEntity } from '@entity';
import { cn, InlineCheckbox } from '@ui';
import { Show } from 'solid-js';
import { useIsTeamAdmin, useSetEmailSyncMutation } from './use-crm';

export function CompanySharingSection(props: { company?: CrmCompanyEntity }) {
  const emailSyncMutation = useSetEmailSyncMutation();
  const isTeamAdmin = useIsTeamAdmin();

  const handleToggleEmailSync = async (
    company: CrmCompanyEntity,
    nextEmailSync: boolean
  ) => {
    try {
      await emailSyncMutation.mutateAsync({
        companyId: company.id,
        emailSync: nextEmailSync,
      });
    } catch (error) {
      console.error('failed to update company email sync', error);
      toast.failure('Could not update email sync');
    }
  };

  return (
    <Show
      when={props.company}
      fallback={<div class="text-xs text-ink-muted">Loading…</div>}
    >
      {(company) => {
        // The detail query always supplies a real boolean; `?? false` only
        // covers the type-level "not loaded" case (search-derived entities).
        const isSyncing = () => company().emailSync ?? false;
        // Disable interaction during pending mutations, when the backend
        // would reject (409 CompanyHidden on re-enabling sync for a hidden
        // company — restore it first), or for non-admins. The greyed-out
        // visual is reserved for the non-admin case only.
        const syncDisabled = () =>
          emailSyncMutation.isPending || company().hidden || !isTeamAdmin();

        return (
          <div class="flex flex-col gap-4 text-xs">
            <div class="flex flex-col gap-2">
              <button
                type="button"
                role="checkbox"
                aria-checked={isSyncing()}
                disabled={syncDisabled()}
                onClick={() =>
                  fireAndForget(
                    handleToggleEmailSync(company(), !isSyncing()),
                    'crm'
                  )
                }
                class={cn(
                  'inline-flex items-center gap-2 rounded-md h-7 px-2.5 text-xs select-none w-fit border border-ink-muted/[0.08] bg-ink-muted/[0.025] text-ink hover:bg-ink-muted/[0.06]',
                  !isTeamAdmin() && 'pointer-events-none opacity-50'
                )}
              >
                <InlineCheckbox checked={isSyncing()} />
                <span class="whitespace-nowrap">Sync Emails</span>
              </button>
              <p class="text-ink-muted leading-5">
                Lets everyone on your team see each other's emails with this
                company.
                <Show when={!isTeamAdmin()}>
                  {' '}
                  Contact a team admin or owner to toggle.
                </Show>
              </p>
            </div>
          </div>
        );
      }}
    </Show>
  );
}
