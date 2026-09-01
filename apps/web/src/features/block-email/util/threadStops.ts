import {
  isTruncatedMiddleMessage,
  type NavDirection,
  truncatedMiddleCount,
} from './scrollToMessage';

export type ThreadStop =
  | { kind: 'title' }
  | { kind: 'message'; index: number }
  | { kind: 'hidden-chip' }
  | { kind: 'composer' };

export type HoveredThreadStop =
  | { kind: 'message'; id: string }
  | { kind: 'hidden-chip' };

function sameStop(left: ThreadStop, right: ThreadStop): boolean {
  if (left.kind !== right.kind) return false;
  if (left.kind === 'message' && right.kind === 'message') {
    return left.index === right.index;
  }
  return true;
}

/** Visible reading order: title, shown cards, optional chip, optional composer. */
export function shownStops(args: {
  length: number;
  showMiddle: boolean;
  hasComposer?: boolean;
}): ThreadStop[] {
  const stops: ThreadStop[] = [{ kind: 'title' }];
  const hideMiddle = !args.showMiddle && truncatedMiddleCount(args.length) > 0;
  for (let i = 0; i < args.length; i++) {
    if (hideMiddle && isTruncatedMiddleMessage(i, args.length)) continue;
    stops.push({ kind: 'message', index: i });
    if (hideMiddle && i === 0) stops.push({ kind: 'hidden-chip' });
  }
  if (args.hasComposer) stops.push({ kind: 'composer' });
  return stops;
}

export function adjacentStop(
  stops: ThreadStop[],
  current: ThreadStop,
  dir: NavDirection
): ThreadStop | undefined {
  const index = stops.findIndex((stop) => sameStop(stop, current));
  if (index < 0) return undefined;
  return dir === 'next' ? stops[index + 1] : stops[index - 1];
}

/** First Arrow with no cursor: next lands on the oldest card, prev on the newest. */
export function enterListStop(
  stops: ThreadStop[],
  dir: NavDirection
): ThreadStop | undefined {
  const messages = stops.filter((stop) => stop.kind === 'message');
  return dir === 'prev' ? messages.at(-1) : messages[0];
}

export function threadStopFromHover(
  hover: HoveredThreadStop | undefined,
  messageIds: Array<string | undefined>
): ThreadStop | undefined {
  if (!hover) return undefined;
  if (hover.kind === 'hidden-chip') return { kind: 'hidden-chip' };
  const index = messageIds.indexOf(hover.id);
  if (index < 0) return undefined;
  return { kind: 'message', index };
}

/** Keyboard cursor wins. Otherwise the first arrow steps off the hovered stop. */
export function nextThreadStop(args: {
  stops: ThreadStop[];
  keyboard: ThreadStop | undefined;
  hover: ThreadStop | undefined;
  dir: NavDirection;
}): ThreadStop | undefined {
  const from = args.keyboard ?? args.hover;
  if (from) return adjacentStop(args.stops, from, args.dir);
  return enterListStop(args.stops, args.dir);
}
