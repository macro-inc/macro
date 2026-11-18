import { toast } from '@core/component/Toast/Toast';
import { fireAndForget } from '@core/util/fireAndForget';
import { Telemetry } from '@macro-inc/observability';
import { authServiceClient } from '@service-auth/client';
import { contactsClient } from '@service-contacts/client';
import { useMutation } from '@tanstack/solid-query';

async function addInvitedContact(email: string) {
  const result = await contactsClient.addContact(
    `macro|${email.toLowerCase()}`
  );
  if (result.isErr()) {
    Telemetry.error(result.error, { surface: 'team-invitations' });
  }
}

/** Which addresses got a referral invite and which could not be invited. */
export type ReferralInvitesResult = { sent: string[]; failed: string[] };

/**
 * One request per address, so one failed address doesn't stop the rest. Each
 * invited address is added to the sender's contacts.
 */
function sendReferralInvites(emails: string[]): Promise<ReferralInvitesResult> {
  return Telemetry.span('referral.send_invites', async (span) => {
    span.setAttr('referral.invite_count', emails.length);
    const sent: string[] = [];
    const failed: string[] = [];
    for (const email of emails) {
      const result = await authServiceClient.sendReferralInvite(email);
      if (result.isOk()) {
        sent.push(email);
        fireAndForget(addInvitedContact(email), 'team-invitations');
      } else {
        failed.push(email);
      }
    }
    span.setAttr('referral.failed_count', failed.length);
    return { sent, failed };
  });
}

/** Sends referral invites and reports the outcome with a toast. */
export function useSendReferralInvitesMutation() {
  return useMutation(() => ({
    mutationFn: sendReferralInvites,
    onSuccess: ({ sent, failed }: ReferralInvitesResult) => {
      if (sent.length > 0) {
        toast.success(
          sent.length === 1
            ? 'Invite sent successfully'
            : `${sent.length} invites sent successfully`
        );
      }
      if (failed.length > 0) {
        toast.failure(`Couldn't invite ${failed.join(', ')}`);
      }
    },
  }));
}
