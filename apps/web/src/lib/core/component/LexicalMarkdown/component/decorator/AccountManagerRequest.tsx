import { AccountManagerCard } from '@app/features/account-manager/account-manager-card';
import type { AccountManagerRequestDecoratorProps } from '@macro-inc/lexical-core';

export function AccountManagerRequest(
  props: AccountManagerRequestDecoratorProps
) {
  return <AccountManagerCard grantId={props.grantId} />;
}
