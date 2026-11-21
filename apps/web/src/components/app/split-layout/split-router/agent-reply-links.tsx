import {
  decodePane,
  decodePanes,
  decodeSegment,
  type SplitLocation,
  type SplitRoutesManifest,
  splitPanePaths,
  useOptionalSplitRouter,
} from '@app/lib/split-router';
import { PaneContext } from '@app/lib/split-router/solid/context';
import { NOT_FOUND_ROUTE_ID } from '@app/routes/app-route';
import {
  type AppLinkDescriber,
  AppLinkDescriberContext,
  type AppLinkOpener,
  AppLinkOpenerContext,
} from '@core/component/LexicalMarkdown/component/core/app-link-opener';
import { openDocument } from '@core/component/LexicalMarkdown/component/core/BlockLink';
import { isNativeMobilePlatform } from '@core/mobile/isNativeMobilePlatform';
import { fireAndForget } from '@core/util/fireAndForget';
import { parseInternalAppLink } from '@core/util/macroAppUrl';
import { openInNewSplitForMention } from '@core/util/openInNewSplit';
import { transformShortIdInUrlPathname } from '@core/util/url';
import { createCallback } from '@solid-primitives/rootless';
import { type ParentProps, useContext } from 'solid-js';
import { upgradeLegacyPath } from './legacy-route';
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
 * mention chips do (in place on touch, a new pane when panes stack). Entity
 * links take the mention path, so an open entity is reused and its location
 * applied; any other app route opens at its full location.
 */
function useAgentReplyLinkOpener(
  openOther: AppLinkOpener | undefined
): AppLinkOpener | undefined {
  const router = useOptionalSplitRouter();
  if (!router) return openOther;

  const resolveMention = createMacroMentionLinkResolver(router.routes);
  const pane = useContext(PaneContext);

  return createCallback((url: string) => {
    const newSplit = openInNewSplitForMention(false, true);

    const mention = resolveMention(url);
    if (mention) {
      openDocument(mention.block, mention.id, mention.params, newSplit);
      return true;
    }

    const location = appLinkLocation(router.routes, url);
    if (!location) return openOther?.(url) ?? false;

    const target = { location };
    const source = pane?.pane();
    const opening =
      newSplit || isNativeMobilePlatform() || !source
        ? router.open(target, { newPane: true, source })
        : router.navigatePane(source, target);
    fireAndForget(opening, 'agent-reply-links');
    return true;
  });
}

/**
 * Macro app links inside open in the app, in a new split, instead of a browser
 * tab. `openOther` is offered every other link first, such as a link to code,
 * and `describeOther` names those links in their hover cards.
 */
export function AgentReplyLinks(
  props: ParentProps<{
    openOther?: AppLinkOpener;
    describeOther?: AppLinkDescriber;
  }>
) {
  return (
    <AppLinkOpenerContext.Provider
      value={useAgentReplyLinkOpener(props.openOther)}
    >
      <AppLinkDescriberContext.Provider value={props.describeOther}>
        {props.children}
      </AppLinkDescriberContext.Provider>
    </AppLinkOpenerContext.Provider>
  );
}
