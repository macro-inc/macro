import type { ParentProps } from 'solid-js';

function Graphic(props: ParentProps) {
  return (
    <svg
      class="email-feature-graphic"
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

export function TaskListGraphic() {
  return (
    <Graphic>
      <path d="M36 20h88v62H36Z" opacity=".45" />
      <path d="M44 12h88v62m-80-54h52" opacity=".18" />
      <path d="M36 36h88" opacity=".25" />
      <path d="m46 47 3 3 5-6m-8 18 3 3 5-6M63 48h43M63 63h30" />
      <path d="M46 76h61" opacity=".2" />
    </Graphic>
  );
}

export function TaskConversationGraphic() {
  return (
    <Graphic>
      <path d="M22 19h66v38H49L34 69V57H22Z" opacity=".4" />
      <path d="M34 31h41M34 42h27" opacity=".3" />
      <path d="M91 42h46v43H91Z" fill="#080808" />
      <path d="m100 55 3 3 5-6M115 55h13M100 68h28M100 77h17" opacity=".65" />
      <path d="M70 71h12m-4-4 4 4-4 4" opacity=".5" />
    </Graphic>
  );
}

export function TaskPropertiesGraphic() {
  return (
    <Graphic>
      <path d="M40 16h71l13 13v56H40Z" opacity=".5" />
      <path d="M111 16v13h13M53 37h45M53 70h52M53 78h36" opacity=".25" />
      <rect x="53" y="48" width="18" height="12" rx="6" />
      <rect x="76" y="48" width="18" height="12" rx="6" opacity=".6" />
      <rect x="99" y="48" width="13" height="12" rx="6" opacity=".35" />
      <path d="m58 54 2 2 4-4" />
    </Graphic>
  );
}

export function TaskAgentsGraphic() {
  return (
    <Graphic>
      <path
        d="M35 31v38c0 8 8 12 16 12h56M109 30v33c0 10-7 18-17 18"
        opacity=".5"
      />
      <circle cx="35" cy="25" r="6" />
      <circle cx="109" cy="24" r="6" opacity=".5" />
      <circle cx="115" cy="81" r="6" />
      <path d="m112 81 2 2 4-4" />
      <path
        d="M70 29c0 12-5 17-17 17 12 0 17 5 17 17 0-12 5-17 17-17-12 0-17-5-17-17Z"
        opacity=".7"
      />
    </Graphic>
  );
}
