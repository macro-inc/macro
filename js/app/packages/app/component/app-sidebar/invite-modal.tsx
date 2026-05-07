import { createSignal, Show } from 'solid-js';
import { useReferralCode } from '@core/context/user';
import { getWebOrigin } from '@core/util/webOrigin';
import { authServiceClient } from '@service-auth/client';
import { contactsClient } from '@service-contacts/client';
import { isOk } from '@core/util/maybeResult';
import { Dialog, Button, Panel } from '@ui';
import { toast } from '@core/component/Toast/Toast';
import CloseIcon from '@icon/regular/x.svg';
import ClipboardIcon from '@icon/regular/clipboard.svg';

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
      const result = await authServiceClient.sendReferralInvite(email);
      if (isOk(result)) {
        contactsClient.addContact(`macro|${email.toLowerCase()}`);
      }
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
      <Panel depth={2} active class="max-h-[75vh] text-ink">
        <Panel.Header class="px-2 gap-1">
          <Dialog.CloseButton as={Button} variant="ghost" size="icon-sm">
            <CloseIcon />
          </Dialog.CloseButton>
          <Dialog.Title as="span" class="text-sm font-medium p-0 m-0">
            Invite
          </Dialog.Title>
        </Panel.Header>

        <Panel.Body scroll class="p-3 flex flex-col gap-3">
          <p>
            Invite friends and teammates to Macro. You'll get $100 in credits
            for each person who signs up.
          </p>
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

          <div class="flex justify-end gap-1 pt-2">
            <Button variant="ghost" class="rounded-xs" onClick={handleClose}>
              Cancel
            </Button>
            <Button
              onClick={handleSend}
              variant={
                sending() || !parseEmails(value()).length ? 'ghost' : 'active'
              }
              disabled={sending() || !parseEmails(value()).length}
              class="rounded-xs font-semibold"
            >
              {sending() ? 'Sending…' : 'Send Invites'}
            </Button>
          </div>

          <Show when={referralUrl()}>
            {(url) => (
              <div class="flex flex-col gap-1.5 pt-3 ">
                <p class="text-xs text-ink/50">
                  Or share your personal referral link:
                </p>
                <div class="flex items-stretch gap-2">
                  <input
                    type="text"
                    readOnly
                    value={url()}
                    class="flex-1 px-3 py-1.5 text-xs border border-edge-muted rounded-xs bg-input text-ink/70 outline-none select-all"
                    onClick={(e) => e.currentTarget.select()}
                  />
                  <Button
                    type="button"
                    onClick={handleCopy}
                    size="md"
                    variant="base"
                    class="font-medium rounded-xs border px-2"
                  >
                    <ClipboardIcon class="size-3" />
                    {copied() ? 'Copied!' : 'Copy'}
                  </Button>
                </div>
              </div>
            )}
          </Show>
        </Panel.Body>
      </Panel>
    </Dialog>
  );
};
