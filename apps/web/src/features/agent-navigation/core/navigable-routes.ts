/**
 * Which app routes an agent may open for the person who prompted it
 * (`macro.ui.open`). Closed by default: a route opts in with
 * `info: { navigableByAgent }` on `defineRoute`, so a new route stays closed
 * until someone opens it on purpose. Routes with side effects (calls, sign-in
 * and OAuth callbacks, composing mail, credential settings, debug views)
 * never opt in.
 *
 * The server checks a command's path against the same table before sending
 * it (`crates/agent_code_mode/src/domain/ui_commands/navigable_routes.json`,
 * generated from here by `navigable-routes.test.tsx`), and the tab checks it
 * again against its live route table before opening anything.
 */

import type {
  SplitRouteState,
  SplitRoutesManifest,
} from '@app/lib/split-router';
import { APP_ROUTE_ID } from '@app/routes/app-route';

/** An agent may open the route, or only with these params set to these values. */
export type AgentNavigableRoute =
  | true
  | { readonly params: Readonly<Record<string, readonly string[]>> };

declare module '@app/lib/split-router/routes/types' {
  interface SplitRouteInfo {
    /** Agents may open this route for the person who prompted them. */
    readonly navigableByAgent?: AgentNavigableRoute;
  }
}

/** One pane route branch, in the order the router tries them. */
export type AgentRouteBranch = {
  route: string;
  navigable: boolean;
  /** A literal segment, `:` for any one segment, or `*` for the rest. */
  segments: string[];
};

export type AgentRouteTable = { branches: AgentRouteBranch[] };

type BranchToken =
  | { type: 'static'; value: string }
  | { type: 'param'; name: string }
  | { type: 'catchAll' };

function tokenSegment(token: BranchToken): string {
  if (token.type === 'static') return token.value.toLowerCase();
  if (token.type === 'param') return ':';

  return '*';
}

/** Every combination of the listed values for the restricted params. */
function restrictedVariants(
  tokens: readonly BranchToken[],
  params: Readonly<Record<string, readonly string[]>>
): string[][] {
  let variants: string[][] = [[]];

  for (const token of tokens) {
    const allowed = token.type === 'param' ? params[token.name] : undefined;
    const choices = allowed
      ? allowed.map((value) => value.toLowerCase())
      : [tokenSegment(token)];
    variants = variants.flatMap((variant) =>
      choices.map((choice) => [...variant, choice])
    );
  }

  return variants;
}

/**
 * The pane route branches of an app route table, most specific first, as
 * the server checks them: a branch whose route opted in with restricted
 * params becomes one navigable branch per allowed value, followed by the
 * closed branch for every other value.
 */
export function agentRouteTable(routes: SplitRoutesManifest): AgentRouteTable {
  const branches: AgentRouteBranch[] = [];

  for (const branch of routes.branches) {
    const [root, ...nodes] = branch.nodes;
    const leaf = nodes.at(-1);
    if (root?.definition.id !== APP_ROUTE_ID || !leaf) continue;

    const tokens: BranchToken[] = branch.patterns.flat();
    const route = leaf.definition.id;
    const navigable = leaf.definition.info?.navigableByAgent;

    if (navigable !== undefined && navigable !== true) {
      for (const segments of restrictedVariants(tokens, navigable.params)) {
        branches.push({ route, navigable: true, segments });
      }
    }

    branches.push({
      route,
      navigable: navigable === true,
      segments: tokens.map(tokenSegment),
    });
  }

  return { branches };
}

/** Whether a decoded pane route is one an agent may open, params included. */
export function isNavigableByAgent(
  routes: SplitRoutesManifest,
  route: SplitRouteState
): boolean {
  const leaf = route.matches.at(-1);
  if (!leaf) return false;

  const navigable = routes.byId.get(leaf.id)?.definition.info?.navigableByAgent;
  if (navigable === undefined) return false;
  if (navigable === true) return true;

  return Object.entries(navigable.params).every(([name, allowed]) => {
    const value = leaf.params[name];
    if (typeof value !== 'string') return false;

    return allowed.includes(value.toLowerCase());
  });
}
