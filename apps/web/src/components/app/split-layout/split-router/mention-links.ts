import {
  BlockAliasRegistry,
  BlockRegistry,
} from '@app/lib/constants/block-registry';
import {
  decodeRoute,
  getExternalSearchKeys,
  parseRoutePathname,
  type SplitReference,
  type SplitRoutesManifest,
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
    const entry = segments && decodeRoute(routes, segments);
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
