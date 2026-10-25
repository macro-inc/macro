import { toast } from '@core/component/Toast/Toast';
import { fireAndForget } from '@core/util/fireAndForget';
import { Button, Dialog, Panel } from '@ui';
import { Show } from 'solid-js';

/**
 * Shown when a Microsoft 365 tenant lets only an administrator consent to
 * Macro's permissions. The user cannot finish on their own: they copy the
 * tenant-wide approval link for IT, or connect a different account instead.
 */
export function AdminConsentRequiredDialog(props: {
  open: boolean;
  /** Tenant-wide approval link; absent while loading or when Outlook is off. */
  adminConsentUrl: string | undefined;
  onConnectDifferentAccount: () => void;
  onClose: () => void;
}) {
  const copyApprovalLink = async () => {
    const url = props.adminConsentUrl;
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      toast.failure('Could not copy link');
      return;
    }
    toast.success('Admin approval link copied', {
      subtext: 'Send it to your IT admin. Once approved, connect again.',
    });
  };

  return (
    <Dialog
      open={props.open}
      onOpenChange={(open) => {
        if (!open) props.onClose();
      }}
      position="center"
      class="w-120 max-w-[calc(100vw-2rem)]"
    >
      <Panel depth={2} class="rounded-xl">
        <Panel.Header class="px-6">
          <Dialog.Title class="text-ink text-sm font-semibold">
            Admin approval required
          </Dialog.Title>
        </Panel.Header>
        <Panel.Body class="p-6 font-sans flex flex-col gap-3">
          <Dialog.Description class="text-ink-muted text-sm/tight font-normal">
            Your organization requires an IT admin to approve Macro before you
            can connect this account.
          </Dialog.Description>
          <Show when={props.adminConsentUrl === undefined}>
            <p class="text-ink-muted text-sm">
              The approval link is unavailable right now. Try again later or
              connect a different account.
            </p>
          </Show>
          <div class="pt-3 flex flex-col-reverse sm:flex-row sm:justify-end sm:items-center gap-3">
            <Button
              variant="ghost"
              depth={3}
              onClick={() => props.onConnectDifferentAccount()}
            >
              Connect a different account
            </Button>
            <Button
              variant="strong"
              depth={3}
              disabled={props.adminConsentUrl === undefined}
              onClick={() => fireAndForget(copyApprovalLink(), 'inbox-link')}
            >
              Copy admin approval link
            </Button>
          </div>
        </Panel.Body>
      </Panel>
    </Dialog>
  );
}
