import { createUniqueId, type ParentProps } from 'solid-js';
import './email-feature-graphics.css';

/** Decorative artwork; the adjacent link provides the accessible label. */
function Graphic(props: ParentProps) {
  const id = createUniqueId();
  return (
    <svg
      class="email-feature-graphic"
      width="200"
      height="128"
      viewBox="0 0 200 128"
      fill="none"
      stroke="currentColor"
      stroke-width="1.25"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      <defs>
        <pattern
          id={`${id}-dots`}
          width="16"
          height="16"
          patternUnits="userSpaceOnUse"
        >
          <circle cx="4" cy="4" r=".7" fill="white" opacity=".55" />
          <circle cx="12" cy="4" r=".65" fill="white" opacity=".3" />
          <circle cx="4" cy="12" r=".65" fill="white" opacity=".35" />
          <circle cx="12" cy="12" r=".7" fill="white" opacity=".5" />
        </pattern>
        <radialGradient id={`${id}-fade`}>
          <stop offset=".15" stop-color="white" stop-opacity=".7" />
          <stop offset="1" stop-color="white" stop-opacity="0" />
        </radialGradient>
        <mask id={`${id}-mask`}>
          <ellipse cx="100" cy="64" rx="98" ry="62" fill={`url(#${id}-fade)`} />
        </mask>
      </defs>
      <g stroke="none" mask={`url(#${id}-mask)`}>
        <path d="M0 0h200v128H0z" fill={`url(#${id}-dots)`} />
      </g>
      {props.children}
    </svg>
  );
}

export function OneInboxGraphic() {
  return (
    <Graphic>
      <rect
        x="74"
        y="35"
        width="64"
        height="44"
        rx="7"
        fill="#111"
        stroke-opacity=".25"
      />
      <rect
        x="62"
        y="47"
        width="64"
        height="44"
        rx="7"
        fill="#171717"
        stroke-opacity=".65"
      />
      <path d="m64 51 25 19a8 8 0 0 0 10 0l25-19" stroke-opacity=".85" />
    </Graphic>
  );
}

export function AgenticEditingGraphic() {
  return (
    <Graphic>
      <rect
        x="67"
        y="30"
        width="58"
        height="68"
        rx="7"
        fill="#141414"
        stroke-opacity=".55"
      />
      <path d="M79 46h30M79 56h24" stroke-opacity=".3" />
      <path d="M79 70h22" stroke-opacity=".8" />
      <path d="M107 65v10" stroke="#eee" />
      <path d="M79 84h16" stroke-opacity=".2" />
      <path
        d="M130 33c0 6-3 9-9 9 6 0 9 3 9 9 0-6 3-9 9-9-6 0-9-3-9-9Z"
        fill="#151515"
        stroke-opacity=".85"
      />
    </Graphic>
  );
}

export function SignalNoiseGraphic() {
  return (
    <Graphic>
      <path d="M51 76h98" stroke-opacity=".12" />
      <path
        d="M51 76h17c17 0 17-37 32-37s15 37 32 37h17"
        stroke-opacity=".85"
      />
      <circle cx="100" cy="39" r="10" fill="#0d0d0d" stroke-opacity=".2" />
      <circle cx="100" cy="39" r="3" fill="#deded8" stroke="none" />
    </Graphic>
  );
}

export function EmailSharingGraphic() {
  return (
    <Graphic>
      <path d="M85 65v12a8 8 0 0 0 8 8h14" stroke-opacity=".35" />
      <rect
        x="54"
        y="35"
        width="57"
        height="38"
        rx="6"
        fill="#141414"
        stroke-opacity=".55"
      />
      <path d="m56 39 22 16a8 8 0 0 0 9 0l22-16" stroke-opacity=".7" />
      <rect
        x="104"
        y="62"
        width="40"
        height="35"
        rx="9"
        fill="#191919"
        stroke-opacity=".65"
      />
      <path d="M117 75h15m-16 9h15m-9-15-3 21m11-21-3 21" stroke-opacity=".9" />
    </Graphic>
  );
}

export function AutoTagsGraphic() {
  return (
    <Graphic>
      <path
        d="M66 44h39l29 29-27 27-41-41Z"
        fill="#141414"
        stroke-opacity=".7"
      />
      <circle cx="80" cy="57" r="4" stroke-opacity=".5" />
      <path d="m98 75 6 6 13-13M128 29v14m-7-7h14" stroke-opacity=".85" />
    </Graphic>
  );
}

export function KeyboardSpeedGraphic() {
  return (
    <Graphic>
      <rect
        x="54"
        y="47"
        width="42"
        height="40"
        rx="8"
        fill="#141414"
        stroke-opacity=".55"
      />
      <rect
        x="104"
        y="47"
        width="42"
        height="40"
        rx="8"
        fill="#191919"
        stroke-opacity=".7"
      />
      <path
        d="M80 59v12a5 5 0 0 1-10 0m50-12v16m0-8 10-8m-10 8 10 8"
        stroke-opacity=".9"
      />
    </Graphic>
  );
}
