import type { QueryAccount } from '@queries/auth/account-scope';
import { createSignal } from 'solid-js';

export const [account, setAccount] = createSignal<QueryAccount>({
  userId: 'macro|viewer@example.com',
  session: 0,
});
export const useQueryAccount = () => account;
export const isCurrentQueryAccount = (owner: QueryAccount | undefined) =>
  !!owner &&
  owner.userId === account().userId &&
  owner.session === account().session;
export function assertQueryAccount(
  owner: QueryAccount | undefined
): asserts owner is QueryAccount {
  if (!isCurrentQueryAccount(owner)) throw new Error('Query account changed');
}
