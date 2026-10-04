import {
  BlockAliasRegistry,
  BlockRegistry,
} from '@app/lib/constants/block-registry';
import {
  decodePane,
  decodeSegment,
  type Entry,
  externalSearchKeys,
  type SplitReference,
  type SplitRoutesManifest,
  splitPanePaths,
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

    const panes = splitPanePaths(link.path).map((raw) =>
      decodePane(routes, raw.map(decodeSegment))
    );
    const everyPaneMatched = panes.every((route) => route !== undefined);
    if (!everyPaneMatched) return;
    // A copied layout URL lists panes from left to right without an active-pane id.
    const route = panes.at(-1);
    if (!route) return;

    const leaf = route.matches.at(-1);
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
    const entry: Entry = { id: 'mention', location: { route } };
    const externalKeys = new Set(externalSearchKeys(routes, [entry]));
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
