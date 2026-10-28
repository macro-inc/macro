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
export function LinkedWorkGraphic() {
  return (
    <Graphic>
      <path d="M20 23h66v39H47L33 73V62H20Z" opacity=".35" />
      <path d="M32 35h41M32 46h25" opacity=".3" />
      <path d="M99 16h23l13 13v50H99Z" opacity=".65" />
      <path d="M122 16v13h13M106 42h20M106 51h20M106 61h12" opacity=".4" />
      <path d="M75 73c14 0 12-24 24-24" />
      <circle cx="99" cy="49" r="2" />
    </Graphic>
  );
}
export function ThreadGraphic() {
  return (
    <Graphic>
      <path d="M35 22h92v23H35Z" opacity=".5" />
      <path d="M48 32h62M48 38h34" opacity=".35" />
      <path d="M42 46v18q0 10 12 10h5" opacity=".6" />
      <rect x="62" y="55" width="65" height="27" rx="7" opacity=".6" />
      <path d="M73 65h43M73 73h30" opacity=".35" />
      <circle cx="42" cy="28" r="3" />
    </Graphic>
  );
}
export function EditingGraphic() {
  return (
    <Graphic>
      <path d="M38 13h70l15 15v58H38Z" opacity=".45" />
      <path d="M108 13v15h15M50 35h52M50 43h33M50 71h53" opacity=".3" />
      <path d="M49 55h38" stroke-width="5" opacity=".15" />
      <path d="M49 55h38M49 62h57" />
      <path d="m91 66 4 13 3-5 6-2Z" fill="#080808" />
    </Graphic>
  );
}
export function ContextGraphic() {
  return (
    <Graphic>
      <path d="M22 25h29v43H22ZM109 25h29v43h-29" opacity=".4" />
      <path d="M29 36h14M29 44h10M116 36h14M116 44h10" opacity=".3" />
      <path d="M52 46h18m20 0h18" opacity=".5" />
      <circle cx="80" cy="46" r="13" opacity=".65" />
      <path d="m74 46 4 4 8-8" />
    </Graphic>
  );
}
export function CallGraphic() {
  return (
    <Graphic>
      <rect x="25" y="20" width="110" height="60" rx="9" opacity=".4" />
      <rect x="35" y="30" width="42" height="31" rx="4" opacity=".55" />
      <rect x="82" y="30" width="42" height="31" rx="4" opacity=".3" />
      <circle cx="56" cy="43" r="5" />
      <path d="M46 57c0-10 20-10 20 0M95 69h18" opacity=".6" />
      <circle cx="50" cy="70" r="3" />
      <circle cx="64" cy="70" r="3" opacity=".4" />
    </Graphic>
  );
}
export function DiffGraphic() {
  return (
    <Graphic>
      <rect x="28" y="17" width="104" height="67" rx="5" opacity=".4" />
      <path d="M28 31h104M79 31v53" opacity=".25" />
      <path
        d="M40 44h27M40 55h20M40 66h26M90 44h27M90 55h20M90 66h26"
        opacity=".6"
      />
      <path d="M37 55h33" stroke-width="8" opacity=".1" />
      <path d="M86 66h36" stroke-width="8" opacity=".2" />
    </Graphic>
  );
}
