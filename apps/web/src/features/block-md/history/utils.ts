import { isMacroAgentId, MACRO_AGENT_NAME } from '@core/constant/macroAgent';
import { macroIdToEmail, tryMacroId } from '@core/user';
import { getHashedPaletteColor } from '@ui/utils/palette';

export function userColor(userId: string): string {
  const color = getHashedPaletteColor(userId);
  return `var(--color-${color}, var(--color-pink))`;
}

/**
 * Author sync-service records for edits no user made, such as the imported
 * content a document starts from. Mirrors `SYSTEM_AUTHOR_ID` in sync-service.
 */
export const SYSTEM_AUTHOR_ID = 'system';

/** Prefix of an author id for AI edits made for a user: `ai|<userId>`. */
export const AI_AUTHOR_PREFIX = 'ai|';

/** The user an `ai|<userId>` author edited for, or undefined for any other id. */
export function aiAuthorOnBehalfOf(authorId: string): string | undefined {
  return authorId.startsWith(AI_AUTHOR_PREFIX)
    ? authorId.slice(AI_AUTHOR_PREFIX.length)
    : undefined;
}

export function userLabel(userId: string): string {
  if (userId === 'unknown') return 'Unknown';
  if (userId === SYSTEM_AUTHOR_ID) return MACRO_AGENT_NAME;
  const onBehalfOf = aiAuthorOnBehalfOf(userId);
  if (onBehalfOf !== undefined) return `${userLabel(onBehalfOf)} (AI)`;
  if (isMacroAgentId(userId)) return `${MACRO_AGENT_NAME} (AI)`;
  const id = tryMacroId(userId);
  return id ? macroIdToEmail(id) : userId;
}

export function formatTimestamp(at: Date): string {
  return at.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export function humanizeDuration(ms: number): string {
  const d = ms / 86_400_000;
  if (d >= 1) return `${Math.round(d)}d`;
  const h = ms / 3_600_000;
  if (h >= 1) return `${Math.round(h)}h`;
  return `${Math.max(1, Math.round(ms / 60_000))}m`;
}

export {
  buildCompressedTimeline,
  type CompressedTimeline,
  type Interval,
  warpedIntervalEnd,
} from './timeline';
