import type { JSXElement } from 'solid-js';

export function NameColumn(props: { children: JSXElement }) {
  return (
    <div class="pl-2 flex-1 @min-[500px]/split:basis-8/12 @min-[680px]/split:basis-5/12 flex items-center gap-1 shrink-0 min-w-0 pr-6">
      {props.children}
    </div>
  );
}

export function OwnerColumn(props: { children: JSXElement }) {
  return (
    <div class="hidden @min-[680px]/split:flex basis-3/12 items-center gap-2 shrink-0 min-w-0">
      {props.children}
    </div>
  );
}

export function TimeColumn(props: { children: JSXElement }) {
  return (
    <div class="hidden @min-[500px]/split:flex basis-3/12 items-center gap-1 shrink-0 min-w-0">
      {props.children}
    </div>
  );
}

export function ActionColumn(props: { children?: JSXElement; class?: string }) {
  return (
    <div
      class={`@min-[500px]/split:basis-1/12 flex items-center justify-end shrink-0 min-w-0 ${props.class}`}
    >
      {props.children}
    </div>
  );
}
