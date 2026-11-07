import { Avatar } from '@ui';

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
