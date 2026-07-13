import { toast } from '@core/component/Toast/Toast';
import { useSetContactHiddenMutation } from '@queries/crm/contacts';
import type { CrmContactResponse } from '@service-storage/generated/schemas/crmContactResponse';
import { cn, InlineCheckbox } from '@ui';
import { Show } from 'solid-js';

const TOGGLE_BUTTON_CLASS =
  'inline-flex items-center gap-2 rounded-md h-7 px-2.5 text-xs select-none w-fit border border-ink-muted/[0.08] bg-ink-muted/[0.025] text-ink hover:bg-ink-muted/[0.06]';

/**
 * Admin-only (the parent gates the whole section on `useIsTeamAdmin`):
 * if a non-admin can see the contact at all, it's already visible to them.
 */
export function ContactSharingSection(props: { contact?: CrmContactResponse }) {
  const hiddenMutation = useSetContactHiddenMutation();

  const handleToggle = async (
    contact: CrmContactResponse,
    nextShared: boolean
  ) => {
    const willHide = !nextShared;
    try {
      await hiddenMutation.mutateAsync({
        contactId: contact.id,
        hidden: willHide,
      });
      if (willHide) {
        toast.success('Contact hidden.');
      }
    } catch (error) {
      console.error('failed to update contact sharing', error);
      toast.failure('Could not update contact visibility');
    }
  };

  return (
    <Show
      when={props.contact}
      fallback={<div class="text-xs text-ink-muted">Loading…</div>}
    >
      {(contact) => {
        const isShared = () => !contact().hidden;
        return (
          <div class="flex flex-col gap-4 text-xs">
            <div class="flex flex-col gap-2">
              <button
                type="button"
                role="checkbox"
                aria-checked={isShared()}
                disabled={hiddenMutation.isPending}
                onClick={() => void handleToggle(contact(), !isShared())}
                class={cn(TOGGLE_BUTTON_CLASS)}
              >
                <InlineCheckbox checked={isShared()} />
                <span class="whitespace-nowrap">Visible in CRM</span>
              </button>
              <p class="text-ink-muted leading-5">
                Shows this contact in their company's contact list. Hide
                contacts that aren't relevant to your team's CRM.
              </p>
            </div>
          </div>
        );
      }}
    </Show>
  );
}
