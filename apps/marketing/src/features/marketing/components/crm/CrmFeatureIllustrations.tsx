import type { JSX } from 'solid-js';

function Illustration(props: { children: JSX.Element }) {
  return (
    <svg
      viewBox="0 0 240 144"
      fill="none"
      aria-hidden="true"
      class="crm-feature-art"
    >
      <g
        stroke="currentColor"
        stroke-width="1.15"
        stroke-linecap="round"
        stroke-linejoin="round"
      >
        {props.children}
      </g>
    </svg>
  );
}

export function CaptureIllustration() {
  return (
    <Illustration>
      <g opacity=".32">
        <rect x="31" y="29" width="68" height="44" rx="5" />
        <path d="m32 33 33 23 33-23" />
      </g>
      <g opacity=".65" fill="#0a0a0a">
        <rect x="41" y="46" width="68" height="44" rx="5" />
        <path d="m42 50 33 23 33-23" />
      </g>
      <g fill="#111">
        <rect x="51" y="63" width="68" height="44" rx="5" />
        <path d="m52 67 33 23 33-23" />
      </g>
      <path d="M120 86h18q11 0 11-11V61" opacity=".4" stroke-dasharray="2 4" />
      <g fill="#111">
        <rect x="136" y="28" width="75" height="72" rx="7" />
        <path d="M136 47h75" opacity=".4" />
        <circle cx="150" cy="38" r="2" fill="currentColor" stroke="none" />
        <path d="M160 38h30M160 62h36M160 80h25" opacity=".6" />
        <circle cx="149" cy="62" r="4" />
        <circle cx="149" cy="80" r="4" />
      </g>
      <path d="m184 109 5 5 11-12" stroke="#b5cbbb" />
    </Illustration>
  );
}

export function ContextIllustration() {
  return (
    <Illustration>
      <path
        d="M63 48h41M159 89h23M78 114h30"
        opacity=".35"
        stroke-dasharray="2 4"
      />
      <g fill="#0b0b0b" opacity=".6">
        <path d="M31 24h56a5 5 0 0 1 5 5v30a5 5 0 0 1-5 5H56L44 74V64H31a5 5 0 0 1-5-5V29a5 5 0 0 1 5-5Z" />
        <path d="M38 38h40M38 48h27" />
      </g>
      <g fill="#111">
        <rect x="87" y="42" width="80" height="77" rx="7" />
        <circle cx="107" cy="64" r="7" />
        <path d="M124 59h25M124 68h16M101 88h49M101 101h34" opacity=".6" />
      </g>
      <g fill="#111">
        <path d="M166 23h40a5 5 0 0 1 5 5v23a5 5 0 0 1-5 5h-9l-8 8v-8h-23a5 5 0 0 1-5-5V28a5 5 0 0 1 5-5Z" />
        <path d="M173 35h25M173 44h18" opacity=".6" />
      </g>
      <circle cx="190" cy="102" r="10" opacity=".4" />
      <path d="M184 102h12M190 96v12" opacity=".6" />
    </Illustration>
  );
}

export function AgentIllustration() {
  return (
    <Illustration>
      <g opacity=".3">
        <rect x="29" y="29" width="171" height="86" rx="7" />
        <path d="M29 49h171M87 49v66M144 49v66" />
      </g>
      <g fill="#111">
        <rect x="39" y="59" width="38" height="21" rx="4" opacity=".4" />
        <path d="M48 69h17" opacity=".35" />
        <rect x="98" y="59" width="36" height="21" rx="4" />
        <path d="M107 69h17" opacity=".7" />
        <rect x="98" y="88" width="36" height="18" rx="4" opacity=".4" />
      </g>
      <path d="M64 89c-2 18 52 42 109-7" opacity=".5" stroke-dasharray="2 4" />
      <g fill="#171717">
        <rect x="155" y="61" width="36" height="21" rx="4" />
        <path d="m164 71 4 4 9-9" stroke="#b5cbbb" />
      </g>
      <path d="m176 81 4 28 7-8 10 1Z" fill="#c2c2c2" stroke="#c2c2c2" />
    </Illustration>
  );
}
