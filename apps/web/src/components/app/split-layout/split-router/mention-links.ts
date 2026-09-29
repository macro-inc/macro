import {
  BlockAliasRegistry,
  BlockRegistry,
} from '@app/lib/constants/block-registry';
import {
  decodeRouteLayout,
  getExternalSearchKeys,
  parseRoutePathname,
  SPLIT_PATH_SEPARATOR,
  type SplitReference,
  type SplitRoutesManifest,
  useOptionalSplitRouter,
} from '@app/lib/split-router';
import type { BlockAlias, BlockName } from '@core/block';
import { parseInternalAppLink } from '@core/util/macroAppUrl';
import { z } from 'zod';

export type MacroMentionLink = {
  id: string;
  block: BlockName | BlockAlias;
  params: Record<string, string>;
};

export type MacroMentionLinkResolver = (
  url: string
) => MacroMentionLink | undefined;

const referenceSchema = z.object({
  id: z.string().min(1),
  type: z.enum([...BlockRegistry, ...BlockAliasRegistry]),
});
const uuidReferenceSchema = referenceSchema.extend({
  id: z.guid(),
});

export function uuidRouteReference(
  id: unknown,
  type: unknown
): SplitReference | undefined {
  const parsed = uuidReferenceSchema.safeParse({ id, type });
  return parsed.success ? parsed.data : undefined;
}

function isBlockRouteReference(
  reference: SplitReference | undefined
): reference is SplitReference & { type: BlockName | BlockAlias } {
  return referenceSchema.safeParse(reference).success;
}

/** Interpret a matched app route as an entity without importing eager view routes. */
export function createMacroMentionLinkResolver(
  routes: SplitRoutesManifest
): MacroMentionLinkResolver {
  return (url) => {
    const link = parseInternalAppLink(url);
    if (!link) return;

    const segments = parseRoutePathname(routes, link.path);
    if (!segments) return;
    const entries = decodeRouteLayout(routes, segments);
    const paneCount =
      segments.filter((segment) => segment === SPLIT_PATH_SEPARATOR).length + 1;
    if (entries.length !== paneCount) return;
    // A copied layout URL lists panes from left to right without an active-pane id.
    const entry = entries.at(-1);
    if (!entry) return;

    const leaf = entry.location.route.matches.at(-1);
    if (!leaf) return;
    const reference = routes.byId
      .get(leaf.id)
      ?.definition.toReference?.(leaf.params);
    if (!isBlockRouteReference(reference)) return;
    const mention: MacroMentionLink = {
      id: reference.id,
      block: reference.type,
      params: {},
    };
    const externalKeys = getExternalSearchKeys(routes, [entry]);
    new URLSearchParams(link.query).forEach((value, key) => {
      if (key !== 'referral_code' && externalKeys.has(key)) {
        mention.params[key] = value;
      }
    });
    return mention;
  };
}

/** Capture an app-owned resolver at an editor host, then pass it to the editor. */
export function useMacroMentionLinkResolver():
  | MacroMentionLinkResolver
  | undefined {
  const router = useOptionalSplitRouter();
  return router && createMacroMentionLinkResolver(router.routes);
}
