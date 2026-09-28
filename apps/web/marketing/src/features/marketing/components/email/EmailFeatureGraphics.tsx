import type { ParentProps } from 'solid-js';

// Small, website-owned line drawings. Decorative: the adjacent link supplies
// the accessible label, and the SVGs need no image request or animation runtime.
function Graphic(props: ParentProps) {
  return (
    <svg
      class="email-feature-graphic"
      width="160"
      height="100"
      viewBox="0 0 160 100"
      fill="none"
      stroke="currentColor"
      stroke-width="1"
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
      <g opacity=".25">
        <path d="m34 31 38-19 45 22-38 19Z" />
        <path d="m34 31 38 3 45 0" />
      </g>
      <g opacity=".5">
        <path d="m34 42 38-19 45 22-38 19Z" fill="#080808" />
        <path d="m34 42 39 3 44 0M73 45l6 19" />
      </g>
      <path d="m34 53 38-19 45 22-38 19Z" fill="#0b0b0b" />
      <path d="m34 53 39 3 44 0M73 56l6 19" opacity=".8" />
      <path
        d="m24 60 16-8m70 0 22 11-47 24-61-27v10l61 27 47-24V63"
        opacity=".35"
      />
      <path
        d="m24 60 24 11 10-5 25 11 10-5 15 3 24-12M85 87v10"
        opacity=".65"
      />
    </Graphic>
  );
}

export function AgenticEditingGraphic() {
  return (
    <Graphic>
      <path d="m37 32 46-22 41 20v47L78 99 37 79Z" opacity=".18" />
      <path d="M40 22h65l15 15v47H40Z" fill="#070707" opacity=".65" />
      <path d="M105 22v15h15" opacity=".5" />
      <path d="M52 38h30M52 48h52M52 58h18" opacity=".4" />
      <path d="M78 58h26" opacity=".18" />
      <path d="M76 55h30" opacity=".45" />
      <path d="M52 69h43" />
      <path d="M99 63v12m-2-12h4m-4 12h4" />
      <path
        d="M130 14c0 6-3 9-9 9 6 0 9 3 9 9 0-6 3-9 9-9-6 0-9-3-9-9Z"
        opacity=".65"
      />
    </Graphic>
  );
}

export function SignalNoiseGraphic() {
  return (
    <Graphic>
      <path d="M18 51h124M80 15v70" opacity=".12" />
      <g opacity=".2">
        <path d="M23 68v7m8-13v20m8-12v6m8-16v24m8-16v8m8-10v14m8-9v5m8-12v17m8-14v9m8-17v25m8-16v8m8-15v21m8-12v6m8-11v15m8-10v5" />
      </g>
      <path d="M18 49h17c13 0 15-26 27-26s14 37 26 37 14-26 26-26 16 15 28 15" />
      <circle cx="62" cy="23" r="2.5" fill="#000" />
      <path d="M62 12v-4m-11 5-3-3m25 3 3-3" opacity=".35" />
    </Graphic>
  );
}

export function EmailSharingGraphic() {
  return (
    <Graphic>
      <path d="M25 27h45v31H25Z" fill="#080808" />
      <path d="m25 28 22.5 17L70 28M25 58l16-18m29 18L54 40" opacity=".7" />
      <path
        d="M70 43h9c7 0 10 4 10 10v5c0 6 4 10 10 10h8m-5-5 5 5-5 5"
        opacity=".5"
      />
      <path d="M94 43h45v43H94" opacity=".16" />
      <path d="M110 51h29v35h-29" opacity=".5" />
      <path d="M117 60h15m-16 8h15m-10-13-3 19m10-19-3 19" />
      <circle cx="107" cy="26" r="4" opacity=".45" />
      <circle cx="122" cy="26" r="4" opacity=".25" />
      <path d="M99 38c0-6 3-8 8-8s8 2 8 8m0-7c8-3 15 0 15 7" opacity=".3" />
    </Graphic>
  );
}
