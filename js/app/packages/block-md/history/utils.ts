import { macroIdToEmail, tryMacroId } from '@core/user';

export const LANE_HUES = [30, 60, 90, 120, 150, 180, 210, 240, 270, 300, 330];

export function userColor(userId: string): string {
  let hash = 0;
  for (let i = 0; i < userId.length; i++) {
    hash = (hash * 31 + userId.charCodeAt(i)) | 0;
  }
  return `var(--color-accent-${LANE_HUES[Math.abs(hash) % LANE_HUES.length]})`;
}

export function userLabel(userId: string): string {
  if (userId === 'unknown') return 'Unknown';
  const id = tryMacroId(userId);
  return id ? macroIdToEmail(id) : userId;
}

export function formatTimestamp(at: Date): string {
  return at.toLocaleString(undefined, {
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
