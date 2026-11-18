import { AccountManagerCardFrame } from '@app/features/account-manager/account-manager-card-frame';
import { lazyNamed } from '@core/util/lazyNamed';
import type { AccountManagerRequestDecoratorProps } from '@macro-inc/lexical-core';
import { Suspense } from 'solid-js';

const AccountManagerCard = lazyNamed(
  () => import('@app/features/account-manager/account-manager-card'),
  'AccountManagerCard'
);

/** Source `importJSON` keeps a stored null or omitted grant id; the card shows it as unavailable. */
export type AccountManagerRequestUIProps = Omit<
  AccountManagerRequestDecoratorProps,
  'grantId'
> & { grantId?: string | null };

export function AccountManagerRequest(props: AccountManagerRequestUIProps) {
  return (
    <Suspense fallback={<AccountManagerCardFrame />}>
      <AccountManagerCard grantId={props.grantId} />
    </Suspense>
  );
}
