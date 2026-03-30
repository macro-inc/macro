import { Dialog } from '@kobalte/core/dialog';
import { createSignal, Show } from 'solid-js';
import { useReferralCode } from '@core/context/user';
import { getWebOrigin } from '@core/util/webOrigin';
import { authServiceClient } from '@service-auth/client';
import { DialogWrapper } from '@core/component/DialogWrapper';
import { Button } from '@ui/components/Button';
import { toast } from '@core/component/Toast/Toast';
import CloseIcon from '@phosphor-icons/core/regular/x.svg?component-solid';

function parseEmails(raw: string): string[] {
  return raw
    .split(/[,\n\s]/)
    .map((s) => s.trim())
    .filter((s) => s.includes('@'));
}

const [inviteModalOpen, setInviteModalOpen] = createSignal(false);

export { inviteModalOpen, setInviteModalOpen };

export const InviteModal = () => {
  const [value, setValue] = createSignal('');
  const [copied, setCopied] = createSignal(false);
  const [sending, setSending] = createSignal(false);
  const referralCode = useReferralCode();

  const referralUrl = () => {
    const code = referralCode();
    if (!code) return undefined;
    return `${getWebOrigin()}/app/signup?referral_code=${code}`;
  };

  const handleCopy = () => {
    const url = referralUrl();
    if (!url) return;
    navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleSend = async () => {
    const emails = parseEmails(value());
    if (!emails.length) return;
    setSending(true);
    for (const email of emails) {
      authServiceClient.sendReferralInvite(email);
    }
    setValue('');
    setSending(false);
    toast.success(
      emails.length === 1
        ? 'Invite sent successfully'
        : `${emails.length} invites sent successfully`
    );
    setInviteModalOpen(false);
  };

  const handleClose = () => {
    setValue('');
    setInviteModalOpen(false);
  };

  return (
    <Dialog open={inviteModalOpen()} onOpenChange={(o) => !o && handleClose()}>
      <Dialog.Portal>
        <DialogWrapper>
          <div class="flex flex-col text-ink">
            <div class="shrink-0 flex flex-row items-center px-2 gap-2 border-b-1 border-b-edge-muted h-[40px]">
              <Dialog.CloseButton as={Button} variant="ghost" size="icon-sm">
                <CloseIcon />
              </Dialog.CloseButton>
              <Dialog.Title as="span" class="text-sm font-medium p-0 m-0">
                Invite Your Team
              </Dialog.Title>
            </div>

            <div class="p-3 flex flex-col gap-3">
              <div class="flex flex-col gap-2">
                <textarea
                  ref={(el) => {
                    requestAnimationFrame(() =>
                      requestAnimationFrame(() => el.focus())
                    );
                  }}
                  placeholder={'name@company.com\ncolleague@company.com'}
                  value={value()}
                  onInput={(e) => setValue(e.currentTarget.value)}
                  rows={4}
                  class="w-full px-3 py-2 text-sm border border-edge-muted rounded-xs bg-input text-ink placeholder:text-ink/30 outline-none focus:border-accent/50 resize-none leading-relaxed"
                />
              </div>

              <Show when={referralUrl()}>
                {(url) => (
                  <div class="flex flex-col gap-1.5 pt-3 border-t border-edge-muted">
                    <p class="text-xs text-ink/50">
                      Or share your personal referral link:
                    </p>
                    <div class="flex items-center gap-2">
                      <input
                        type="text"
                        readOnly
                        value={url()}
                        class="flex-1 px-3 py-1.5 text-xs border border-edge-muted rounded-xs bg-input text-ink/70 outline-none select-all"
                        onClick={(e) => e.currentTarget.select()}
                      />
                      <button
                        type="button"
                        onClick={handleCopy}
                        class="px-3 py-1.5 text-xs font-medium rounded-xs border border-edge-muted bg-panel text-ink hover:bg-hover/60 transition-colors whitespace-nowrap"
                      >
                        {copied() ? 'Copied!' : 'Copy'}
                      </button>
                    </div>
                  </div>
                )}
              </Show>

              <div class="flex justify-end gap-2 pt-2">
                <Button variant="ghost" onClick={handleClose}>
                  Cancel
                </Button>
                <button
                  type="button"
                  onClick={handleSend}
                  disabled={sending() || !parseEmails(value()).length}
                  class="py-1.5 px-3 text-sm font-medium rounded-xs bg-accent text-menu hover:bg-accent/90 transition-colors disabled:opacity-50"
                >
                  {sending() ? 'Sending…' : 'Send Invites'}
                </button>
              </div>
            </div>
          </div>
        </DialogWrapper>
      </Dialog.Portal>
    </Dialog>
  );
};
