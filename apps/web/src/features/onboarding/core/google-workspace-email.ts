import { emailDomain } from './team';

/** Shown when the address is not a Google Workspace work email. */
export const WORKSPACE_EMAIL_MESSAGE = 'Use a Google Workspace work email.';

const PERSONAL_DOMAINS = new Set([
  'aol.com',
  'duck.com',
  'fastmail.com',
  'gmail.com',
  'gmx.com',
  'googlemail.com',
  'hey.com',
  'hotmail.com',
  'icloud.com',
  'live.com',
  'mac.com',
  'mail.com',
  'me.com',
  'msn.com',
  'outlook.com',
  'pm.me',
  'proton.me',
  'protonmail.com',
  'yahoo.com',
  'ymail.com',
  'zoho.com',
]);

/** Google Workspace mail exchangers. Consumer Gmail uses a different host. */
const WORKSPACE_MX_HOSTS = new Set([
  'smtp.google.com',
  'aspmx.l.google.com',
  'alt1.aspmx.l.google.com',
  'alt2.aspmx.l.google.com',
  'alt3.aspmx.l.google.com',
  'alt4.aspmx.l.google.com',
  'aspmx2.googlemail.com',
  'aspmx3.googlemail.com',
  'aspmx4.googlemail.com',
  'aspmx5.googlemail.com',
]);

export function isPersonalEmailDomain(email: string): boolean {
  const domain = emailDomain(email);
  return domain !== undefined && PERSONAL_DOMAINS.has(domain);
}

/** The mail host mail is delivered to: the MX exchange with the lowest preference. */
export function primaryMxHost(records: readonly string[]): string | undefined {
  let best: { preference: number; host: string } | undefined;
  for (const record of records) {
    const match = /^(\d+)\s+(\S+)$/.exec(record.trim());
    if (!match) continue;
    const preference = Number(match[1]);
    const host = match[2].replace(/\.$/, '').toLowerCase();
    if (!best || preference < best.preference) best = { preference, host };
  }
  return best?.host;
}

export function isGoogleWorkspaceMxHost(host: string): boolean {
  return WORKSPACE_MX_HOSTS.has(host.toLowerCase().replace(/\.$/, ''));
}

type DnsAnswer = { type?: number; data?: string };

/** True when the domain's primary MX is a Google Workspace exchanger. */
export function acceptsWorkspaceMx(body: {
  Status?: number;
  Answer?: DnsAnswer[];
}): boolean {
  if (body.Status !== 0 || !body.Answer) return false;
  const records = body.Answer.filter((answer) => answer.type === 15).flatMap(
    (answer) => (typeof answer.data === 'string' ? [answer.data] : [])
  );
  const host = primaryMxHost(records);
  return host !== undefined && isGoogleWorkspaceMxHost(host);
}

/**
 * Whether this address can start the mobile workspace. Personal providers
 * are refused immediately. Other domains must publish a Google Workspace MX
 * record. A lookup failure refuses the address.
 */
export async function isGoogleWorkspaceWorkEmail(
  email: string
): Promise<boolean> {
  if (isPersonalEmailDomain(email)) return false;
  const domain = emailDomain(email);
  if (!domain || !/^[a-z0-9.-]+$/.test(domain)) return false;
  const response = await fetch(
    `https://dns.google/resolve?name=${encodeURIComponent(domain)}&type=MX`
  );
  if (!response.ok) return false;
  const body = (await response.json()) as {
    Status?: number;
    Answer?: DnsAnswer[];
  };
  return acceptsWorkspaceMx(body);
}
