import { AccountManagerCardFrame } from '@app/features/account-manager/account-manager-card-frame';
import { lazyNamed } from '@core/util/lazyNamed';
import type { AccountManagerRequestDecoratorProps } from '@macro-inc/lexical-core';
import { Suspense } from 'solid-js';

const AccountManagerCard = lazyNamed(
  () => import('@app/features/account-manager/account-manager-card'),
  'AccountManagerCard'
);

export function AccountManagerRequest(
  props: AccountManagerRequestDecoratorProps
) {
  return (
    <Suspense fallback={<AccountManagerCardFrame />}>
      <AccountManagerCard grantId={props.grantId} />
    </Suspense>
  );
}
