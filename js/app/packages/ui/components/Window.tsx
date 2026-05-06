import type { ParentProps } from 'solid-js';
import { Show, splitProps } from 'solid-js';
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
      style={{
        'grid-template-areas': '"header" "toolbar" "body" "footer"',
        'grid-template-rows': 'auto auto minmax(0, 1fr) auto',
        'grid-template-columns': 'minmax(0, 1fr)',
      }}
      class="grid min-h-0 min-w-0"
      {...panelProps}
    >
      {local.children}
    </Panel>
  );
}

Window.Header = (props: ParentProps) => (
  <Show when={props.children}>
    <div
      class="box-border flex h-10 items-center gap-1 border-b border-edge-muted px-2"
      style={{ 'grid-area': 'header' }}
    >
      {props.children}
    </div>
  </Show>
);

Window.Toolbar = (props: ParentProps) => (
  <Show when={props.children}>
    <div
      class="box-border flex h-10 items-center gap-1 border-b border-edge-muted px-2"
      style={{ 'grid-area': 'toolbar' }}
    >
      {props.children}
    </div>
  </Show>
);

Window.Body = (props: ParentProps) => (
  <Show when={props.children}>
    <div
      class="relative min-h-0 min-w-0 overflow-hidden"
      style={{ 'grid-area': 'body' }}
    >
      {props.children}
    </div>
  </Show>
);

Window.Footer = (props: ParentProps) => (
  <Show when={props.children}>
    <div
      class="flex h-10 items-center gap-1 border-t border-edge-muted px-2"
      style={{ 'grid-area': 'footer' }}
    >
      {props.children}
    </div>
  </Show>
);
