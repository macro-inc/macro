import { useSplitLayout } from '@app/component/split-layout/layout';
import { toast } from '@core/component/Toast/Toast';
import type { CrmCompanyEntity } from '@entity';
import {
  useSetCompanyHiddenMutation,
  useSetEmailSyncMutation,
} from '@queries/crm/companies';
import { useIsTeamAdmin } from '@queries/team/teams';
import { cn, InlineCheckbox } from '@ui';
import { Show } from 'solid-js';

const TOGGLE_BUTTON_CLASS =
  'inline-flex items-center gap-2 rounded-md h-7 px-2.5 text-xs select-none w-fit border border-ink-muted/[0.08] bg-ink-muted/[0.025] text-ink hover:bg-ink-muted/[0.06]';

export function CompanySharingSection(props: { company?: CrmCompanyEntity }) {
  const hideMutation = useSetCompanyHiddenMutation();
  const emailSyncMutation = useSetEmailSyncMutation();
  const { replaceOrInsertSplit } = useSplitLayout();
  const isTeamAdmin = useIsTeamAdmin();

  const handleToggleShare = async (
    company: CrmCompanyEntity,
    nextShared: boolean
  ) => {
    const willHide = !nextShared;
    try {
      await hideMutation.mutateAsync({
        companyId: company.id,
        hidden: willHide,
      });
      // On hide (un-share), drop the user back to the companies list and toast.
      // Un-hide leaves them on the block.
      if (willHide) {
        toast.success('Company hidden.');
        replaceOrInsertSplit({ type: 'component', id: 'companies' });
      }
    } catch (error) {
      console.error('failed to update company sharing', error);
      toast.failure('Could not update company visibility');
    }
  };

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
        const isShared = () => !company().hidden;
        // The detail query always supplies a real boolean; `?? false` only
        // covers the type-level "not loaded" case (search-derived entities).
        const isSyncing = () => company().emailSync ?? false;
        // Disable interaction during pending mutations, when the backend
        // would reject (409 CompanyHidden on re-enabling sync for a hidden
        // company — un-share first), or for non-admins. The greyed-out
        // visual is reserved for the non-admin case only.
        const shareDisabled = () => hideMutation.isPending || !isTeamAdmin();
        const syncDisabled = () =>
          emailSyncMutation.isPending || company().hidden || !isTeamAdmin();

        return (
          <div class="flex flex-col gap-4 text-xs">
            {/* Admin/owner-only: if a non-admin can see the company at all,
                it's already visible to them. */}
            <Show when={isTeamAdmin()}>
              <div class="flex flex-col gap-2">
                <button
                  type="button"
                  role="checkbox"
                  aria-checked={isShared()}
                  disabled={shareDisabled()}
                  onClick={() => void handleToggleShare(company(), !isShared())}
                  class={cn(TOGGLE_BUTTON_CLASS)}
                >
                  <InlineCheckbox checked={isShared()} />
                  <span class="whitespace-nowrap">Visible in CRM</span>
                </button>
                <p class="text-ink-muted leading-5">
                  Shows this company in your team's CRM lists and search. Hide
                  companies that aren't relevant to your team's CRM.
                </p>
              </div>
            </Show>

            <div class="flex flex-col gap-2">
              <button
                type="button"
                role="checkbox"
                aria-checked={isSyncing()}
                disabled={syncDisabled()}
                onClick={() =>
                  void handleToggleEmailSync(company(), !isSyncing())
                }
                class={cn(
                  TOGGLE_BUTTON_CLASS,
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
