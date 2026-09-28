/**
 * Pure helpers for GTM invite links: the personal, time-limited signup links
 * Macro staff hand to prospects. The welcome page (`/invite?token=…`) parks
 * the token in localStorage until the visitor has an account; the first
 * authenticated load redeems it and the plan step shows the offer.
 */
import { isTauri } from '@core/util/platform';
import type { GtmInviteLinkStatus } from '@service-auth/generated/schemas/gtmInviteLinkStatus';
import { match } from 'ts-pattern';

/** Where the welcome page parks the token until the visitor has an account. */
export const PENDING_INVITE_TOKEN_STORAGE_KEY = 'gtm_invite_pending_token';
/** Query parameter carrying the token on the welcome page. */
export const INVITE_TOKEN_PARAM = 'token';
/** Query parameter carrying the token onto the signup page (analytics only). */
export const SIGNUP_INVITE_PARAM = 'gtm_invite';
/** Base-relative route of the public welcome page. */
export const INVITE_ROUTE = '/invite';
/** Base-relative route of the staff dashboard. */
export const INVITE_PORTAL_ROUTE = '/internal/invite-links';

/** Mirrors the backend's token shape: 16–64 URL-safe characters. */
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{16,64}$/;

export function isPlausibleInviteToken(value: unknown): value is string {
  return typeof value === 'string' && TOKEN_PATTERN.test(value);
}

/**
 * The origin recipients should open links on. Staff may create links from
 * the desktop app, whose own origin (`tauri://…`) means nothing to a
 * prospect, so links always point at the web app.
 */
export function inviteLinkOrigin(): string {
  if (
    typeof window !== 'undefined' &&
    !isTauri() &&
    window.location.hostname === 'localhost'
  ) {
    return window.location.origin;
  }
  return import.meta.env.MODE === 'development'
    ? 'https://dev.macro.com'
    : 'https://macro.com';
}

export function buildInviteLinkUrl(
  token: string,
  origin: string = inviteLinkOrigin()
): string {
  return `${origin}/app${INVITE_ROUTE}?${INVITE_TOKEN_PARAM}=${encodeURIComponent(token)}`;
}

export function savePendingInviteToken(token: string): void {
  try {
    localStorage.setItem(PENDING_INVITE_TOKEN_STORAGE_KEY, token);
  } catch {
    // Private mode / blocked storage: the signup still works, unattributed.
  }
}

export function getPendingInviteToken(): string | undefined {
  try {
    const value = localStorage.getItem(PENDING_INVITE_TOKEN_STORAGE_KEY);
    return isPlausibleInviteToken(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

export function clearPendingInviteToken(): void {
  try {
    localStorage.removeItem(PENDING_INVITE_TOKEN_STORAGE_KEY);
  } catch {
    // Nothing to clear.
  }
}

export type InviteStatusTone = 'accent' | 'muted' | 'success' | 'failure';

export interface InviteStatusPresentation {
  label: string;
  tone: InviteStatusTone;
}

/** Dashboard wording and color for a link's lifecycle status. */
export function describeInviteStatus(
  status: GtmInviteLinkStatus
): InviteStatusPresentation {
  return match(status)
    .with('active', () => ({ label: 'Active', tone: 'accent' as const }))
    .with('expired', () => ({ label: 'Expired', tone: 'muted' as const }))
    .with('revoked', () => ({ label: 'Revoked', tone: 'failure' as const }))
    .with('redeemed', () => ({ label: 'Signed up', tone: 'success' as const }))
    .with('converted', () => ({
      label: 'Subscribed',
      tone: 'success' as const,
    }))
    .exhaustive();
}

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;

/** "47h 12m left", "8m left", or "Expired" for an active link's window. */
export function formatTimeLeft(
  expiresAt: string,
  now: number = Date.now()
): string {
  const remaining = new Date(expiresAt).getTime() - now;
  if (!Number.isFinite(remaining)) return '';
  if (remaining <= 0) return 'Expired';
  const hours = Math.floor(remaining / HOUR_MS);
  const minutes = Math.floor((remaining % HOUR_MS) / MINUTE_MS);
  if (hours === 0) return `${Math.max(minutes, 1)}m left`;
  return minutes === 0 ? `${hours}h left` : `${hours}h ${minutes}m left`;
}

/** "1 month free" / "3 months free" for offer badges. */
export function formatFreeMonths(freeMonths: number): string {
  return `${freeMonths} ${freeMonths === 1 ? 'month' : 'months'} free`;
}
