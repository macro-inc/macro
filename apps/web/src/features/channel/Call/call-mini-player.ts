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
  const left =
    edge.includes('left') ||
    ((edge === 'top' || edge === 'bottom') && corner.endsWith('right'));
  const top =
    edge.includes('top') ||
    ((edge === 'left' || edge === 'right') && corner.startsWith('bottom'));
  const fixedX = left ? box.x + box.width : box.x;
  const fixedY = top ? box.y + box.height : box.y;
  const overhead = box.height - mediaHeight;
  const maxWidth = Math.max(
    0,
    Math.min(
      MAX_CALL_PLAYER_WIDTH,
      viewportWidth - 24,
      audioOnly ? Infinity : ((viewportHeight - 180) * 16) / 9 + 16,
      left ? fixedX - 12 : viewportWidth - fixedX - 12,
      audioOnly
        ? Infinity
        : (Math.max(
            0,
            (top ? fixedY - 12 : viewportHeight - fixedY - 12) - overhead
          ) *
            16) /
            9 +
            16
    )
  );
  const minWidth = Math.min(256, maxWidth);
  const horizontal = edge.includes('left') || edge.includes('right');
  const vertical = edge.includes('top') || edge.includes('bottom');
  let width = box.width;
  if (horizontal) width += dx * (left ? -1 : 1);
  if (!audioOnly && vertical) {
    const fromHeight = box.width + (dy * (top ? -1 : 1) * 16) / 9;
    if (
      !horizontal ||
      Math.abs(fromHeight - box.width) > Math.abs(width - box.width)
    )
      width = fromHeight;
  }
  width = Math.max(minWidth, Math.min(maxWidth, width));

  const maxMediaHeight = Math.max(
    0,
    (top ? fixedY - 12 : viewportHeight - fixedY - 12) - overhead
  );
  const height = audioOnly
    ? Math.max(
        144,
        Math.min(
          maxMediaHeight,
          mediaHeight + (vertical ? dy * (top ? -1 : 1) : 0)
        )
      )
    : ((width - 16) * 9) / 16;
  return {
    x: left ? fixedX - width : fixedX,
    y: top ? fixedY - overhead - height : fixedY,
    width,
    mediaHeight: height,
  };
}
