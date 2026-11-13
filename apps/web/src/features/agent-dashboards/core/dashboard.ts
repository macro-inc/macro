import type { View } from '@app/features/dynamic-ui/view';

/** What the viewer may do with a dashboard; people only view in v1. */
export type DashboardAccessLevel = 'view' | 'comment' | 'edit' | 'owner';

/** A persisted, versioned dynamic-UI view an agent composed. */
export type Dashboard = {
  id: string;
  ownerId: string;
  title: string | null;
  version: number;
  view: View;
  accessLevel: DashboardAccessLevel;
  createdAt: string;
  updatedAt: string;
};

/**
 * Why a dashboard did not load. `missing` covers both "none set" and "no
 * access" for a home dashboard: that route answers 404 for either, so the
 * two cannot be told apart.
 */
export type DashboardFailure = 'missing' | 'forbidden' | 'failed';

/**
 * The agent on the other side of a direct message: the one participant who
 * isn't the viewer, when that account is an agent.
 */
export function directMessageAgent(options: {
  isDirectMessage: boolean;
  participantIds: readonly string[];
  viewerId: string | undefined;
  isAgentAccount: (id: string) => boolean;
}): string | undefined {
  if (!options.isDirectMessage || !options.viewerId) return undefined;

  const others = options.participantIds.filter((id) => id !== options.viewerId);
  if (others.length !== 1) return undefined;

  const [other] = others;
  return options.isAgentAccount(other) ? other : undefined;
}

/** The dashboard's own title, else its view's; undefined when it has neither. */
export function dashboardTitle(dashboard: Dashboard): string | undefined {
  return dashboard.title ?? dashboard.view.title ?? undefined;
}

/**
 * Whose profile a click on an account opens: the account itself when it is an
 * agent and agent dashboards are on. Undefined means the click keeps doing
 * what it did before (a person's DM, their card).
 */
export function agentProfileTarget(options: {
  userId: string | undefined;
  flagEnabled: boolean;
  isAgentAccount: (id: string) => boolean;
}): string | undefined {
  if (!options.flagEnabled || !options.userId) return undefined;
  return options.isAgentAccount(options.userId) ? options.userId : undefined;
}
