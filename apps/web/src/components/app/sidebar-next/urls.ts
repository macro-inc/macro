import { ROUTER_BASE_CONCAT } from '@app/constants/routerBase';
import type { SplitContent } from '@components/app/split-layout/layoutManager';

/**
 * The browser URL a split content deserializes from, e.g.
 * `/app/component/documents` or `/app/calendar/view`.
 *
 * Mirrors `contentUrlSegments` in `layoutManager` and the `decodePairs` reader
 * in `layoutUtils`: the layout URL is `<type>/<id>` pairs, so the bare
 * `LIST_VIEW_PATHS` entries (`/documents`) are *not* usable as tab URLs —
 * `decodePairs` breaks on the missing id and falls back to the inbox.
 */
export const splitContentUrl = (content: SplitContent): string => {
  // Aliased blocks serialise under their alias, matching `getAliasOrType`.
  const type =
    content.type === 'component'
      ? content.type
      : (content.aliasContext?.alias ?? content.type);
  return `${ROUTER_BASE_CONCAT}${type}/${content.id}`;
};
