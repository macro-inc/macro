export const MAX_CALL_PLAYER_WIDTH = 960;
export type CallPreviewParticipant = {
  id: string;
  speaking: boolean;
  hasVideo: boolean;
  sharing: boolean;
};

export function selectCallPreview<T extends CallPreviewParticipant>(
  participants: readonly T[]
): T | undefined {
  return (
    participants.find((participant) => participant.sharing) ??
    participants.find((participant) => participant.speaking) ??
    participants.find((participant) => participant.hasVideo) ??
    participants[0]
  );
}

export type CallPlayerCorner =
  | 'top-left'
  | 'top-right'
  | 'bottom-left'
  | 'bottom-right';

export function nearestCallPlayerCorner(
  x: number,
  y: number,
  width: number,
  height: number,
  viewportWidth: number,
  viewportHeight: number
): CallPlayerCorner {
  const horizontal = x + width / 2 < viewportWidth / 2 ? 'left' : 'right';
  const vertical = y + height / 2 < viewportHeight / 2 ? 'top' : 'bottom';
  return `${vertical}-${horizontal}`;
}

export function constrainCallPlayerPosition(
  x: number,
  y: number,
  width: number,
  height: number,
  viewportWidth: number,
  viewportHeight: number
) {
  // Keep a safety inset on every edge. Tiny viewports collapse to the inset
  // instead of producing negative coordinates or sending the player offscreen.
  return {
    x: Math.max(12, Math.min(x, viewportWidth - width - 12)),
    y: Math.max(12, Math.min(y, viewportHeight - height - 12)),
  };
}

/** Engage only when both player edges are within 24px of a window corner. */
export function getCallPlayerSnapTarget(
  x: number,
  y: number,
  width: number,
  height: number,
  viewportWidth: number,
  viewportHeight: number
) {
  const corner = nearestCallPlayerCorner(
    x,
    y,
    width,
    height,
    viewportWidth,
    viewportHeight
  );
  const target = constrainCallPlayerPosition(
    corner.endsWith('left') ? 20 : viewportWidth - width - 20,
    corner.startsWith('top') ? 20 : viewportHeight - height - 20,
    width,
    height,
    viewportWidth,
    viewportHeight
  );
  const horizontalGap = corner.endsWith('left') ? x : viewportWidth - x - width;
  const verticalGap = corner.startsWith('top')
    ? y
    : viewportHeight - y - height;
  if (horizontalGap > 24 || verticalGap > 24) return undefined;
  return { ...target, width, height, corner };
}

/** Preview only: the magnet still engages at 24px on both edges. */
export const CALL_PLAYER_APPROACH_DISTANCE = 120;

export function getCallPlayerSnapPreview(
  x: number,
  y: number,
  width: number,
  height: number,
  viewportWidth: number,
  viewportHeight: number
) {
  // Use the farther of the two edge gaps so one close edge cannot snap alone.
  // Squaring progress gives a faint approach cue before the 24px snap threshold.
  const corner = nearestCallPlayerCorner(
    x,
    y,
    width,
    height,
    viewportWidth,
    viewportHeight
  );
  const gap = Math.max(
    corner.endsWith('left') ? x : viewportWidth - x - width,
    corner.startsWith('top') ? y : viewportHeight - y - height
  );
  if (gap >= CALL_PLAYER_APPROACH_DISTANCE) return undefined;
  const progress = Math.max(
    0,
    Math.min(
      1,
      (CALL_PLAYER_APPROACH_DISTANCE - gap) /
        (CALL_PLAYER_APPROACH_DISTANCE - 24)
    )
  );
  return { corner, width, height, opacity: progress * progress };
}

export type CallPlayerResizeEdge =
  | 'top'
  | 'bottom'
  | 'left'
  | 'right'
  | 'top-left'
  | 'top-right'
  | 'bottom-left'
  | 'bottom-right';

/** Resize from an edge while keeping the opposite sides fixed. */
export function resizeCallPlayer(
  edge: CallPlayerResizeEdge,
  box: { x: number; y: number; width: number; height: number },
  mediaHeight: number,
  dx: number,
  dy: number,
  viewportWidth: number,
  viewportHeight: number,
  audioOnly: boolean,
  corner: CallPlayerCorner
) {
  // Resize around the opposite edges. Convert vertical drag to the media ratio,
  // then clamp against the viewport and chrome before rebuilding the position.
  const verticalEdge = edge === 'top' || edge === 'bottom';
  const horizontalEdge = edge === 'left' || edge === 'right';
  const left =
    edge.includes('left') || (verticalEdge && corner.endsWith('right'));
  const top =
    edge.includes('top') || (horizontalEdge && corner.startsWith('bottom'));
  const fixedX = left ? box.x + box.width : box.x;
  const fixedY = top ? box.y + box.height : box.y;
  const overhead = box.height - mediaHeight;
  const availableWidth = left ? fixedX - 12 : viewportWidth - fixedX - 12;
  const availableHeight = top ? fixedY - 12 : viewportHeight - fixedY - 12;
  const maxMediaHeight = Math.max(0, availableHeight - overhead);
  const viewportMediaWidth = ((viewportHeight - 180) * 16) / 9 + 16;
  const heightLimitedWidth = (maxMediaHeight * 16) / 9 + 16;
  const maxWidth = Math.max(
    0,
    Math.min(
      MAX_CALL_PLAYER_WIDTH,
      viewportWidth - 24,
      availableWidth,
      audioOnly ? Infinity : viewportMediaWidth,
      audioOnly ? Infinity : heightLimitedWidth
    )
  );
  const minWidth = Math.min(256, maxWidth);
  const horizontal = edge.includes('left') || edge.includes('right');
  const vertical = edge.includes('top') || edge.includes('bottom');
  const horizontalDirection = left ? -1 : 1;
  const verticalDirection = top ? -1 : 1;
  let width = box.width;
  if (horizontal) width += dx * horizontalDirection;
  if (!audioOnly && vertical) {
    const fromHeight = box.width + (dy * verticalDirection * 16) / 9;
    const heightMovedFarther =
      Math.abs(fromHeight - box.width) > Math.abs(width - box.width);
    if (!horizontal || heightMovedFarther) width = fromHeight;
  }
  width = Math.max(minWidth, Math.min(maxWidth, width));

  let height = ((width - 16) * 9) / 16;
  if (audioOnly) {
    const heightDelta = vertical ? dy * verticalDirection : 0;
    height = Math.max(144, Math.min(maxMediaHeight, mediaHeight + heightDelta));
  }
  return {
    x: left ? fixedX - width : fixedX,
    y: top ? fixedY - overhead - height : fixedY,
    width,
    mediaHeight: height,
  };
}
