import {
  decodePane,
  decodePanes,
  decodeSegment,
  type SplitLocation,
  type SplitRoutesManifest,
  splitPanePaths,
  useOptionalSplitRouter,
} from '@app/lib/split-router';
import { NOT_FOUND_ROUTE_ID } from '@app/routes/app-route';
import {
  type AppLinkOpener,
  AppLinkOpenerContext,
} from '@core/component/LexicalMarkdown/component/core/app-link-opener';
import { openDocument } from '@core/component/LexicalMarkdown/component/core/BlockLink';
import { parseInternalAppLink } from '@core/util/macroAppUrl';
import { openInNewSplitForMention } from '@core/util/openInNewSplit';
import { transformShortIdInUrlPathname } from '@core/util/url';
import { createCallback } from '@solid-primitives/rootless';
import type { ParentProps } from 'solid-js';
import { useSplitLayout } from '../layout';
import { splitContentFromLocation, upgradeLegacyPath } from './legacy-route';
import { createMacroMentionLinkResolver } from './mention-links';

/**
 * The location a Macro app link shows in its last pane, as the router would
 * read the URL. Undefined when a pane matches no route.
 */
function appLinkLocation(
  routes: SplitRoutesManifest,
  url: string
): SplitLocation | undefined {
  const link = parseInternalAppLink(url);
  if (!link) return;

  const path = upgradeLegacyPath(
    routes,
    transformShortIdInUrlPathname(link.path)
  );
  const matched = splitPanePaths(path).every((raw) => {
    const route = decodePane(routes, raw.map(decodeSegment));
    return (
      route !== undefined && route.matches.at(-1)?.id !== NOT_FOUND_ROUTE_ID
    );
  });
  if (!matched) return;

  const { panes } = decodePanes(routes, {
    path,
    search: link.query ? `?${link.query}` : '',
    hash: '',
  });
  return panes.at(-1)?.entry.location;
}

/**
 * Opens a Macro app link from an agent's reply in a new split, as the reply's
 * mention chips do (in place on touch). Entity links take the mention path, so
 * an open entity is reused and its location applied; any other app route opens
 * by its location.
 */
function useAgentReplyLinkOpener(): AppLinkOpener | undefined {
  const router = useOptionalSplitRouter();
  if (!router) return;

  const resolveMention = createMacroMentionLinkResolver(router.routes);
  const { openWithSplit } = useSplitLayout();

  return createCallback((url: string) => {
    const newSplit = openInNewSplitForMention(false, true);

    const mention = resolveMention(url);
    if (mention) {
      openDocument(mention.block, mention.id, mention.params, newSplit);
      return true;
    }

    const location = appLinkLocation(router.routes, url);
    if (!location) return false;

    // A view already open is reused, as for entities; a copied layout's own
    // search state goes through the router with it.
    openWithSplit(splitContentFromLocation(location), {
      preferNewSplit: newSplit,
      ...(location.search && { search: location.search }),
    });
    return true;
  });
}

/** Macro app links inside open in the app, in a new split, instead of a browser tab. */
export function AgentReplyLinks(props: ParentProps) {
  return (
    <AppLinkOpenerContext.Provider value={useAgentReplyLinkOpener()}>
      {props.children}
    </AppLinkOpenerContext.Provider>
  );
}
