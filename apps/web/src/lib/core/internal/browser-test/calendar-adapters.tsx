import type { IUser } from '@core/user/types';
import { Avatar } from '@ui';
import type { JSX } from 'solid-js';

export { recipientEntityMapper } from '@core/user/combinedRecipient';
export const emailToId = (email: string) => `macro|${email}`;
export const useUserId = () => () => 'macro|viewer@example.com';
export const useEmail = () => () => 'viewer@example.com';
export const useAugmentUserWithDmActivity = () => (user: IUser) => user;
export const UserTooltip = (props: { children?: JSX.Element }) =>
  props.children;
export const toast = { failure: (_message: string) => {} };

/** Only profile/navigation services are replaced; menu controls and contact
 * query/lookup state are the production implementations. */
export function EntityIcon() {
  return <span aria-hidden="true" />;
}
export function UserIcon(props: { name?: string }) {
  return (
    <Avatar size="sm">
      <Avatar.Fallback>{props.name?.slice(0, 1)}</Avatar.Fallback>
    </Avatar>
  );
}
export function useContactFilterSource(): never {
  throw new Error('Fixture must inject its contact source');
}
