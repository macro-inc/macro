import { WORKSPACE_ACCENTS } from './workspace-accent';

const KEY = 'macro:meta-mobile-draft';

export type MetaMobileDraft = {
  accent: string;
  teamName: string;
  email: string;
  invites: string[];
  /** Set once the workspace email has been sent. */
  ready: boolean;
  /** Google is required, so the team is finished on the computer. */
  googleOnDesktop?: boolean;
};

const isAccent = (value: unknown): value is string =>
  typeof value === 'string' &&
  WORKSPACE_ACCENTS.some(
    (accent) => accent.color.toLowerCase() === value.toLowerCase()
  );

/** A stored draft, or nothing when storage is missing or malformed. */
export function parseMetaMobileDraft(
  raw: string | null
): MetaMobileDraft | undefined {
  let value: unknown;
  try {
    value = JSON.parse(raw ?? 'null');
  } catch {
    return undefined;
  }
  if (!value || typeof value !== 'object') return undefined;
  if (!('accent' in value) || !isAccent(value.accent)) return undefined;
  const teamName = 'teamName' in value ? value.teamName : '';
  const email = 'email' in value ? value.email : '';
  const invites = 'invites' in value ? value.invites : [];
  if (typeof teamName !== 'string' || typeof email !== 'string')
    return undefined;
  if (
    !Array.isArray(invites) ||
    invites.some((item) => typeof item !== 'string')
  )
    return undefined;
  return {
    accent: value.accent,
    teamName,
    email,
    invites,
    ready: 'ready' in value && value.ready === true,
    googleOnDesktop:
      'googleOnDesktop' in value && value.googleOnDesktop === true,
  };
}

export function readMetaMobileDraft(): MetaMobileDraft | undefined {
  try {
    return parseMetaMobileDraft(sessionStorage.getItem(KEY));
  } catch {
    return undefined;
  }
}

export function writeMetaMobileDraft(draft: MetaMobileDraft | undefined) {
  try {
    if (!draft) sessionStorage.removeItem(KEY);
    else sessionStorage.setItem(KEY, JSON.stringify(draft));
  } catch {
    // The flow still runs; a reload just starts again.
  }
}
