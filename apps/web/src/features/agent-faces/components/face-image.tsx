import { type AgentFace, renderFace } from '@macro-inc/agent-faces';
import { Avatar } from '@ui';
import { createMemo } from 'solid-js';

/**
 * A face, or a photo chosen in its place, drawn as a circle `size` px wide, or
 * filling its parent for `'fill'`.
 */
export function FaceImage(props: {
  face: AgentFace;
  photoUrl?: string;
  size: number | 'fill';
  /** Shown if the picture fails to load. */
  initials: string;
}) {
  const src = createMemo(
    () =>
      props.photoUrl ??
      `data:image/svg+xml;charset=utf-8,${encodeURIComponent(renderFace(props.face))}`
  );
  return (
    <span
      class="block shrink-0"
      style={
        props.size === 'fill'
          ? { width: '100%', height: '100%' }
          : { width: `${props.size}px`, height: `${props.size}px` }
      }
    >
      <Avatar size="fill" highlightEdge>
        <Avatar.Image src={src()} alt="" class="bg-surface object-cover" />
        <Avatar.Fallback class="font-semibold">
          {props.initials}
        </Avatar.Fallback>
      </Avatar>
    </span>
  );
}
