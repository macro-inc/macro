/**
 * The `ui_command` frame an agent's program sends to the person who prompted
 * it (`macro.ui.open`), and what this tab does with it.
 *
 * The connection gateway delivers a frame to every connection the person has
 * open. A tab applies it only when it names this tab and this person, and
 * only for a single pane on a route agents may open, checked against the
 * tab's own route table whatever the server already checked.
 */

import {
  decodePane,
  decodePanes,
  decodeSegment,
  type SplitLocation,
  type SplitRoutesManifest,
  splitPanePaths,
} from '@app/lib/split-router';
import { upgradeLegacyPath } from '@components/app/split-layout/split-router/legacy-route';
import { z } from 'zod';
import { isNavigableByAgent } from './navigable-routes';

export const UI_COMMAND_MESSAGE = 'ui_command';

export const uiCommandFrameSchema = z.object({
  commandId: z.string().min(1),
  userId: z.string().min(1),
  clientId: z.string().min(1),
  sessionId: z.string().min(1),
  agentName: z.string(),
  kind: z.literal('open'),
  path: z.string(),
  placement: z.enum(['beside-agent', 'new']),
});

export type UiCommandFrame = z.infer<typeof uiCommandFrameSchema>;

/** Who this tab is: its signed-in person and its own tab id. */
export type UiCommandRecipient = {
  userId: string;
  clientId: string;
};

export type UiCommandDecision =
  /** Not for this tab; another tab or device applies it, or nobody does. */
  | { kind: 'ignore' }
  /** For this tab, but not a path agents may open. */
  | { kind: 'refuse' }
  | {
      kind: 'open';
      frame: UiCommandFrame;
      location: SplitLocation;
      route: string;
    };

/** One app path with an optional query; never an origin or a fragment. */
const APP_PATH = /^\/(?!\/)[^?#\\:]*(\?[^#\\]*)?$/;

/** `.` and `..` would resolve to another route once the URL is normalised. */
const DOT_SEGMENTS = ['.', '..'];

function paneRoute(routes: SplitRoutesManifest, path: string) {
  const panes = splitPanePaths(path);
  if (panes.length !== 1) return;

  const segments = panes[0]!.map(decodeSegment);
  if (segments.some((segment) => DOT_SEGMENTS.includes(segment))) return;

  return decodePane(routes, segments);
}

/**
 * What this tab does with a frame: ignore one meant for another tab or
 * person, refuse a path agents may not open, or open a location in a new
 * pane. The path is checked as sent (a legacy `type/id` link opens only for
 * item types) and again as the router upgrades it.
 */
export function decideUiCommand(
  routes: SplitRoutesManifest,
  recipient: UiCommandRecipient,
  payload: unknown
): UiCommandDecision {
  const parsed = uiCommandFrameSchema.safeParse(payload);
  if (!parsed.success) return { kind: 'ignore' };

  const frame = parsed.data;
  const forThisTab =
    frame.userId === recipient.userId && frame.clientId === recipient.clientId;
  if (!forThisTab) return { kind: 'ignore' };
  if (!APP_PATH.test(frame.path)) return { kind: 'refuse' };

  const queryStart = frame.path.indexOf('?');
  const path = queryStart === -1 ? frame.path : frame.path.slice(0, queryStart);
  const query = queryStart === -1 ? '' : frame.path.slice(queryStart + 1);
  const sent = paneRoute(routes, path);
  if (!sent || !isNavigableByAgent(routes, sent)) return { kind: 'refuse' };

  const upgraded = upgradeLegacyPath(routes, path);
  const route = paneRoute(routes, upgraded);
  if (!route || !isNavigableByAgent(routes, route)) return { kind: 'refuse' };

  const { panes } = decodePanes(routes, {
    path: upgraded,
    search: query ? `?${query}` : '',
    hash: '',
  });
  const location = panes[0]?.entry.location;
  const leaf = route.matches.at(-1);
  if (!location || !leaf) return { kind: 'refuse' };

  return { kind: 'open', frame, location, route: leaf.id };
}
