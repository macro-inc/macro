import { Show, splitProps } from 'solid-js';
import type { ParentProps } from 'solid-js';
import type { PanelProps } from './Panel';
import { Panel } from './Panel';

/**
 * ```tsx
 * <Window>
 *   <Window.Header>Title</Window.Header>
 *   <Window.Toolbar>...</Window.Toolbar>
 *   <Window.Body>...</Window.Body>
 *   <Window.Footer>...</Window.Footer>
 * </Window>
 * ```
 */

export type WindowProps = PanelProps;

export function Window(props: WindowProps) {
  const [local, panelProps] = splitProps(props, ['children']);

  return (
    <Panel
      {...panelProps}
      class="grid min-h-0 min-w-0"
      style={{
        'grid-template-areas': '"header" "toolbar" "body" "footer"',
        'grid-template-rows': 'auto auto minmax(0, 1fr) auto',
        'grid-template-columns': 'minmax(0, 1fr)',
      }}
    >
      {local.children}
    </Panel>
  );
}

type SlotProps = ParentProps;

Window.Header = (props: SlotProps) => (
  <Show when={props.children}>
    <div
      class="box-border flex h-10 items-center gap-1 border-b border-edge-muted px-2"
      style={{ 'grid-area': 'header' }}
      data-window-header
    >
      {props.children}
    </div>
  </Show>
);

Window.Toolbar = (props: SlotProps) => (
  <Show when={props.children}>
    <div
      class="box-border flex h-10 items-center gap-1 border-b border-edge-muted px-2"
      style={{ 'grid-area': 'toolbar' }}
      data-window-toolbar
    >
      {props.children}
    </div>
  </Show>
);

Window.Body = (props: SlotProps) => (
  <Show when={props.children}>
    <div
      class="relative min-h-0 min-w-0 overflow-hidden"
      style={{ 'grid-area': 'body' }}
      data-window-body
    >
      {props.children}
    </div>
  </Show>
);

Window.Footer = (props: SlotProps) => (
  <Show when={props.children}>
    <div
      class="flex h-10 items-center gap-1 border-t border-edge-muted px-2"
      style={{ 'grid-area': 'footer' }}
      data-window-footer
    >
      {props.children}
    </div>
  </Show>
);
