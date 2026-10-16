import { connectSlugForPipedreamApp } from '@core/pipedream/slugs';

/**
 * A connect link handed out by Macro's `SetupConnect` MCP tool:
 * `/app/connect/:app?account=<email>&expires=<unix seconds>`.
 *
 * The person's own AI agent sets up their workspace and sends them here to do
 * the one thing only they can: approve access to a tool. The page runs the
 * same connection flow as settings, signed in, so the connection is recorded
 * against the right account.
 */
export type AgentConnectTarget =
  | { kind: 'inbox'; app: 'gmail'; name: 'Gmail' }
  | { kind: 'connector'; app: string; name: string; connectSlug: string };

// Links carry the Pipedream slug; these don't title-case to the app's name.
const KNOWN_NAMES: Record<string, string> = {
  slack_v2: 'Slack',
  github: 'GitHub',
  hubspot: 'HubSpot',
  clickup: 'ClickUp',
  monday: 'monday.com',
  salesforce_rest_api: 'Salesforce',
  zoho_crm: 'Zoho CRM',
  microsoft_onedrive: 'OneDrive',
  microsoft_outlook: 'Outlook',
};

function displayName(app: string): string {
  return (
    KNOWN_NAMES[app] ??
    app
      .split('_')
      .filter(Boolean)
      .map((word) => word[0]!.toUpperCase() + word.slice(1))
      .join(' ')
  );
}

/** The tool a connect link is for, or `undefined` for a malformed one. */
export function agentConnectTarget(
  app: string | undefined
): AgentConnectTarget | undefined {
  const slug = app?.trim().toLowerCase();
  if (!slug || !/^[a-z0-9_]+$/.test(slug)) return undefined;
  if (slug === 'gmail') return { kind: 'inbox', app: 'gmail', name: 'Gmail' };
  return {
    kind: 'connector',
    app: slug,
    name: displayName(slug),
    connectSlug: connectSlugForPipedreamApp(slug),
  };
}

/**
 * Whether the link carries the account and expiry every `SetupConnect` link
 * has. A link without them is not one Macro handed out, so consent never
 * starts from it. (These guard against mistakes, not deliberate edits: the
 * connection is always recorded against the signed-in account.)
 */
export function hasLinkGuards(
  account: string | undefined,
  expires: string | undefined
): boolean {
  return (
    !!account?.trim() &&
    expires !== undefined &&
    expires.trim() !== '' &&
    Number.isFinite(Number(expires))
  );
}

/** Whether the link's `expires` (unix seconds) has passed. */
export function isExpired(
  expires: string | undefined,
  nowMs: number = Date.now()
): boolean {
  const seconds = Number(expires);
  if (!expires || !Number.isFinite(seconds)) return true;
  return seconds * 1000 < nowMs;
}

/** Whether the signed-in account is the one the agent set up. */
export function isSameAccount(
  linkAccount: string | undefined,
  signedInEmail: string | undefined
): boolean {
  if (!linkAccount || !signedInEmail) return false;
  return (
    linkAccount.trim().toLowerCase() === signedInEmail.trim().toLowerCase()
  );
}
