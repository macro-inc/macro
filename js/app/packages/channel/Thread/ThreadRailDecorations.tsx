import type { Accessor } from 'solid-js';
import {
  getInnerRailBottom,
  innerRailTop,
  innerRailX,
  threadConnectorStyle,
} from './thread-rail-geometry';

type ThreadRailDecorationsProps = {
  isReplying: Accessor<boolean>;
};

export function ThreadRailDecorations(props: ThreadRailDecorationsProps) {
  return (
    <>
      <div class="pointer-events-none absolute" style={threadConnectorStyle}>
        <div class="absolute text-edge-muted -z-1 w-full h-full">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 18"
            width="100%"
            height="100%"
          >
            <path
              stroke="currentColor"
              vector-effect="non-scaling-stroke"
              d="M0 0.5 24 17.5"
            />
          </svg>
        </div>
      </div>
      <div
        class="pointer-events-none absolute bottom-0 -z-1 border-l border-edge-muted/80"
        style={{
          left: innerRailX,
          top: innerRailTop,
          bottom: getInnerRailBottom(props.isReplying()),
        }}
      />
    </>
  );
}
