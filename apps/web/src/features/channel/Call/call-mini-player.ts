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
