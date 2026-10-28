import type { ParentProps } from 'solid-js';
import './email-feature-graphics.css';

/** Decorative artwork; the adjacent link provides the accessible label. */
function Graphic(props: ParentProps) {
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
      <path d="M65 36 99 17l42 24-34 20Z" fill="#111213" />
      <path
        d="m65 36 42 25v36L65 72ZM107 61l34-20v36l-34 20"
        stroke="#555a60"
      />
      <path d="m79 36 20-11 28 16-20 12Z" stroke="#555a60" />
      <path d="m84 36 13 8m-6-12 18 11m-10-15 19 11" />
      <path d="m116 65 13-8m-13 15 19-11" stroke="#555a60" />
      <path d="m98 43 8 5" stroke="#b6c7bf" stroke-width="2" />
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
      <path d="m48 51 37-21 43 25-37 21Z" fill="#111213" />
      <path d="m48 51 43 25v9L48 60Zm43 25 37-21v9L91 85" stroke="#555a60" />
      <path d="m53 51 34 5 34-1M87 56l4 15" />
      <path d="m109 81 16-9 24 14-16 9Z" fill="#111213" />
      <path d="m109 81 24 14v6l-24-14m24 8 16-9v6l-16 9" stroke="#555a60" />
      <path d="m119 82 12 7m-7-10 12 7m-16 0 11-6m-6 9 11-6" />
    </Graphic>
  );
}

export function AutoTagsGraphic() {
  return (
    <Graphic>
      <path d="m52 56 33-25 57 34-31 19-29-1Z" fill="#111213" />
      <path d="m52 56 30 27 29 1 31-19v7l-31 19-29-1-30-27Z" stroke="#555a60" />
      <ellipse cx="81" cy="51" rx="5" ry="3" />
      <path d="m96 63 8 6 18-10" stroke="#b6c7bf" />
    </Graphic>
  );
}

export function KeyboardSpeedGraphic() {
  return (
    <Graphic>
      <path d="m46 52 24-14 33 19-24 14Z" fill="#111213" />
      <path d="m46 52 33 19v9L46 61Zm33 19 24-14v9L79 80" stroke="#555a60" />
      <path d="m68 47 13 8q5 3 0 6l-3 2" />
      <path d="m104 52 24-14 33 19-24 14Z" fill="#111213" />
      <path d="m104 52 33 19v9l-33-19Zm33 19 24-14v9l-24 14" stroke="#555a60" />
      <path d="m124 47 16 9m-9-5 9-1m-9 1 3 8" />
    </Graphic>
  );
}
