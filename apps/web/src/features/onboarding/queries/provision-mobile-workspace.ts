import { SERVER_HOSTS } from '@core/constant/servers';
import { platformFetch } from '@core/util/platformFetch';

export type ProvisionMobileWorkspaceInput = {
  email: string;
  teamName: string;
  accent: string;
  invites: string[];
};

export type ProvisionMobileWorkspaceResult =
  | { t: 'created' }
  | { t: 'sso-required' }
  | { t: 'invalid' }
  | { t: 'rate-limited' }
  | { t: 'failed'; message: string };

/**
 * Creates the team for this email and emails a desktop link. The response
 * does not start a session in this browser.
 */
export async function provisionMobileWorkspace(
  input: ProvisionMobileWorkspaceInput
): Promise<ProvisionMobileWorkspaceResult> {
  const response = await platformFetch(
    `${SERVER_HOSTS['auth-service']}/mobile-workspace`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: input.email,
        team_name: input.teamName,
        accent: input.accent,
        invites: input.invites,
      }),
    }
  ).catch(() => undefined);

  if (!response) return { t: 'failed', message: 'Unable to reach Macro.' };
  if (response.status === 202) return { t: 'sso-required' };
  if (response.ok) return { t: 'created' };
  if (response.status === 400) {
    const body = (await response.json().catch(() => undefined)) as
      | { message?: unknown }
      | undefined;
    if (
      body &&
      typeof body.message === 'string' &&
      body.message.includes('Google Workspace')
    ) {
      return { t: 'failed', message: body.message };
    }
    return { t: 'invalid' };
  }
  if (response.status === 403)
    return { t: 'failed', message: 'That email address was not accepted.' };
  if (response.status === 429) return { t: 'rate-limited' };
  if (import.meta.env.DEV && response.status === 404) {
    return {
      t: 'failed',
      message:
        'This preview can’t create the team yet. The dev signup service doesn’t have this step.',
    };
  }
  return { t: 'failed', message: 'Something went wrong. Please try again.' };
}
