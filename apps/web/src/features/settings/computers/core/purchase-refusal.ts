import { ThrownResultError } from '@core/util/result';
import type { PurchaseRefusalErrorCode } from '@service-auth/purchase-refusal';
import { match } from 'ts-pattern';

/**
 * The shared purchase refusal behind a failed Buy or Add, if it is one: the
 * code the buy and add-agent dialogs both answer in place. Nothing was bought
 * in any of them.
 */
export function purchaseRefusalOf(
  error: unknown
): PurchaseRefusalErrorCode | undefined {
  if (!(error instanceof ThrownResultError)) return undefined;
  return match(error.errors[0]?.code)
    .returnType<PurchaseRefusalErrorCode | undefined>()
    .with(
      'TEAM_ON_TRIAL',
      'PAYMENT_DECLINED',
      'NO_ROOM',
      'INVITE_IN_PROGRESS',
      'HOST_NOT_ELIGIBLE',
      'SELF_HOSTED_NOT_ENABLED',
      (code) => code
    )
    .otherwise(() => undefined);
}
