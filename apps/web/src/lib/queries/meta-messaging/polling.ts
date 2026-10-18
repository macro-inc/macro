import type { MetaSendProgress } from '@service-storage/generated/schemas/metaSendProgress';

type DeliveryProgress = Pick<MetaSendProgress, 'state' | 'created_at'>;

/**
 * Channels whose binding is unknown fail closed and hide the native composer,
 * so a failed first lookup keeps retrying with backoff instead of waiting for focus.
 */
export function bindingRetryInterval(failures: number): number {
  return Math.min(30_000, 2_000 * 2 ** Math.min(Math.max(failures - 1, 0), 4));
}

/** Fast only while a recent send is progressing; never chase read receipts forever. */
export function deliveryPollInterval(
  sends: readonly DeliveryProgress[],
  now = Date.now()
): number | false {
  let interval: number | false = false;
  for (const send of sends) {
    const age = Math.max(0, now - Date.parse(send.created_at));
    const next =
      (send.state === 'pending' || send.state === 'sending') && age < 300_000
        ? 2_000
        : (send.state === 'accepted' || send.state === 'sent') && age < 60_000
          ? 2_000
          : send.state === 'delivered' && age < 60_000
            ? 10_000
            : false;
    if (next && (!interval || next < interval)) interval = next;
  }
  return interval;
}

/** Only background subscription completion needs polling; PIN entry and retry are human actions. */
export function connectionPollInterval(
  accounts:
    | ReadonlyArray<{
        status: string;
        whatsapp_mode?: string | null;
        registration_status?: string | null;
      }>
    | undefined,
  failed = false
): number | false {
  return !failed &&
    accounts?.some(
      (account) =>
        account.status === 'connecting' &&
        (account.whatsapp_mode !== 'platform' ||
          account.registration_status === 'registered')
    )
    ? 3_000
    : false;
}

/** A late signed result remains observable after setup leaves its fast phase. */
export function groupPollInterval(
  state: string | undefined,
  failed = false
): number {
  return !failed && (state === 'creating' || state === 'pending')
    ? 2_000
    : 30_000;
}
