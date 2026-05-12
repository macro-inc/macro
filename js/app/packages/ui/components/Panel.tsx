import type { SurfaceProps } from './Surface';
import type { ParentProps } from 'solid-js';
import { Show, splitProps } from 'solid-js';
import { cn } from '../utils/classname';
import { Surface } from './Surface';
import { Scroll } from './Scroll';

/*
<Panel>
  <Panel.Header></Panel.Header>
  <Panel.Toolbar></Panel.Toolbar>
  <Panel.Body></Panel.Body>
  <Panel.Footer></Panel.Footer>
</Panel>
*/

type BodyProps = ParentProps<{ class?: string; scroll?: boolean }>;
type SlotProps = ParentProps<{ class?: string }>;
type PanelProps = SurfaceProps;

function PanelRoot(props: PanelProps) {
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

function PanelHeader(props: SlotProps) {
  return (
    <Show when={props.children}>
      <div
        class={cn('flex flex-none items-center min-h-10 px-2 overflow-x-hidden border-b border-edge-muted overflow-hidden', props.class)}
        style={{ 'grid-area': 'header' }}
      >
        {props.children}
      </div>
    </Show>
  );
}

function PanelToolbar(props: SlotProps) {
  return (
    <Show when={props.children}>
      <div
        class={cn('flex flex-none items-center min-h-10 px-2 overflow-x-hidden border-b border-edge-muted overflow-hidden', props.class)}
        style={{ 'grid-area': 'toolbar' }}
      >
        {props.children}
      </div>
    </Show>
  );
}

function PanelBody(props: BodyProps) {
  return (
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
}

function PanelFooter(props: SlotProps) {
  return (
    <Show when={props.children}>
      <div
        class={cn('flex flex-none items-center min-h-10 px-2 overflow-x-hidden border-t border-edge-muted overflow-hidden', props.class)}
        style={{ 'grid-area': 'footer' }}
      >
        {props.children}
      </div>
    </Show>
  );
}

export const Panel = Object.assign(PanelRoot, {
  Toolbar: PanelToolbar,
  Header: PanelHeader,
  Footer: PanelFooter,
  Body: PanelBody,
});
