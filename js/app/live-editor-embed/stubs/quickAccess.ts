// Stub for `@core/context/quickAccess` used only by the standalone marketing
// "live editor" embed. The real provider pulls in history/channels/contacts
// queries + websocket; the embed feeds the mentions menu custom `entities`
// instead, so `useQuickAccess().useList()` is never actually consumed — it just
// has to exist so the asserted hook calls in `useUsersMention`/`useEntityMention`
// don't throw.
import type { JSX } from 'solid-js';

export type {
  Bucket,
  EntityBucket,
  EntityItem,
  QuickAccessItem,
  UserItem,
} from '@core/context/quickAccess/types';
export { exclude } from '@core/context/quickAccess/types';

export function useQuickAccess(): any {
  return {
    useList: (..._buckets: unknown[]) => () => [],
  };
}

export function QuickAccessProvider(props: { children?: JSX.Element }) {
  return props.children;
}
