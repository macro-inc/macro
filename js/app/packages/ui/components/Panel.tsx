import type { ParentProps } from 'solid-js';
import { Show, splitProps } from 'solid-js';
import type { SurfaceProps } from './Surface';
import { cn } from '../utils/classname';
import { Scroll } from './Scroll';
import { Surface } from './Surface';

/**
 * ```tsx
 * <Panel>
 *   <Panel.Header>Title</Panel.Header>
 *   <Panel.Toolbar>...</Panel.Toolbar>
 *   <Panel.Body>...</Panel.Body>
 *   <Panel.Footer>...</Panel.Footer>
 * </Panel>
 * ```
 */

export type PanelProps = SurfaceProps;

export function Panel(props: PanelProps) {
  const [local, surfaceProps] = splitProps(props, ['children', 'class']);

  return (
    <Surface
      style={{
        'grid-template-areas': '"header" "toolbar" "body" "footer"',
        'grid-template-rows': 'auto auto minmax(0, 1fr) auto',
        'grid-template-columns': 'minmax(0, 1fr)',
      }}
      class={cn('grid min-h-0 min-w-0', local.class)}
      {...surfaceProps}
    >
      {local.children}
    </Surface>
  );
}

type SlotProps = ParentProps<{ class?: string }>;

Panel.Header = (props: SlotProps) => (
  <Show when={props.children}>
    <div
      class={cn('flex h-10 items-center gap-1 border-b border-edge-muted px-5', props.class)}
      style={{ 'grid-area': 'header' }}
    >
      {props.children}
    </div>
  </Show>
);

Panel.Toolbar = (props: SlotProps) => (
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

Panel.Body = (props: BodyProps) => (
  <Show when={props.children}>
    <Show
      when={props.scroll}
      fallback={
        <div
          class={cn('relative min-h-0 min-w-0 overflow-hidden', props.class)}
          style={{ 'grid-area': 'body' }}
        >
          {props.children}
        </div>
      }
    >
      <Scroll class={props.class} style={{ 'grid-area': 'body' }}>
        {props.children}
      </Scroll>
    </Show>
  </Show>
);

Panel.Footer = (props: SlotProps) => (
  <Show when={props.children}>
    <div
      class={cn('flex h-10 items-center gap-1 border-t border-edge-muted px-5', props.class)}
      style={{ 'grid-area': 'footer' }}
    >
      {props.children}
    </div>
  </Show>
);
