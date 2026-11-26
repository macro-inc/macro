import type { JSX, ParentProps } from 'solid-js';

export const toast = {
  success: (_msg: string) => {},
  error: (_msg: string) => {},
  info: (_msg: string) => {},
};

export const ViewSidebar = {
  Root: (
    props: ParentProps<{
      ref?: (el: HTMLDivElement) => void;
      tabIndex?: number;
      onKeyDown?: JSX.EventHandler<HTMLDivElement, KeyboardEvent>;
      class?: string;
      'data-channel-sidebar-redesign'?: string;
    }>
  ) => (
    <div
      ref={props.ref}
      tabIndex={props.tabIndex}
      onKeyDown={props.onKeyDown}
      data-channel-sidebar-redesign={props['data-channel-sidebar-redesign']}
      class={`flex size-full min-h-0 flex-col bg-panel ${props.class ?? ''}`}
    >
      {props.children}
    </div>
  ),
  Title: (props: ParentProps) => (
    <h1 class="text-sm font-semibold text-ink">{props.children}</h1>
  ),
  Control: (
    props: ParentProps<JSX.ButtonHTMLAttributes<HTMLButtonElement>>
  ) => (
    <button type="button" {...props}>
      {props.children}
    </button>
  ),
};
