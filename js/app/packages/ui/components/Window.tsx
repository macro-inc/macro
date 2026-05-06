import type { ParentProps } from 'solid-js';
import { Show, splitProps } from 'solid-js';
import type { PanelProps } from './Panel';
import { Panel } from './Panel';
import { cn } from '../utils/classname';

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

type SlotProps = ParentProps<{ class?: string }>;

Window.Header = (props: SlotProps) => (
  <Show when={props.children}>
    <div
      class={cn('flex h-10 items-center gap-1 border-b border-edge-muted px-5', props.class)}
      style={{ 'grid-area': 'header' }}
    >
      {props.children}
    </div>
  </Show>
);

Window.Toolbar = (props: SlotProps) => (
  <Show when={props.children}>
    <div
      class={cn('flex h-10 items-center gap-1 border-b border-edge-muted px-5', props.class)}
      style={{ 'grid-area': 'toolbar' }}
    >
      {props.children}
    </div>
  </Show>
);

type BodyProps = ParentProps<{ class?: string; scroll?: boolean }>;

Window.Body = (props: BodyProps) => (
  <Show when={props.children}>
    <div
      class={cn(
        'relative min-h-0 min-w-0',
        props.scroll ? 'overflow-auto' : 'overflow-hidden',
        props.class,
      )}
      style={{ 'grid-area': 'body' }}
    >
      {props.children}
    </div>
  </Show>
);

Window.Footer = (props: SlotProps) => (
  <Show when={props.children}>
    <div
      class={cn('flex h-10 items-center gap-1 border-t border-edge-muted px-5', props.class)}
      style={{ 'grid-area': 'footer' }}
    >
      {props.children}
    </div>
  </Show>
);
