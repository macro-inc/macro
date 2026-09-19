import type { ParentProps } from 'solid-js';
import { children, Show, splitProps } from 'solid-js';
import { cn } from '../utils/classname';
import { Scroll } from './Scroll';
import type { SurfaceProps } from './Surface';
import { Surface } from './Surface';

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
      class={cn('grid min-h-0 min-w-0 bg-panel', local.class)}
      {...surfaceProps}
    >
      {local.children}
    </Surface>
  );
}

function PanelHeader(props: SlotProps) {
  const resolved = children(() => props.children);
  return (
    <Show when={resolved()}>
      <div
        class={cn(
          'flex flex-none items-center min-h-10 px-2 border-b border-edge-muted overflow-hidden',
          props.class
        )}
        style={{ 'grid-area': 'header' }}
      >
        {resolved()}
      </div>
    </Show>
  );
}

function PanelToolbar(props: SlotProps) {
  const resolved = children(() => props.children);
  return (
    <Show when={resolved()}>
      <div
        class={cn(
          'flex flex-none items-center p-2 border-b border-edge-muted overflow-hidden',
          props.class
        )}
        style={{ 'grid-area': 'toolbar' }}
      >
        {resolved()}
      </div>
    </Show>
  );
}

function PanelBody(props: BodyProps) {
  const resolved = children(() => props.children);
  return (
    <Show when={resolved()}>
      <Show
        when={props.scroll}
        fallback={
          <div
            // `clip`, not `hidden`: both clip the overflow, but `hidden` still
            // makes this a scroll container, so focusing anything below the
            // fold — a switch, an input — lets the browser scroll the body to
            // reveal it. With no scrollbar there is no way to scroll back, and
            // the panel looks permanently broken. `clip` is not a scroll
            // container, so it cannot be scrolled programmatically at all.
            // Matches `Surface`, which already uses `overflow-clip`.
            class={cn('relative min-h-0 min-w-0 overflow-clip', props.class)}
            style={{ 'grid-area': 'body' }}
          >
            {resolved()}
          </div>
        }
      >
        <Scroll class={props.class} style={{ 'grid-area': 'body' }}>
          {resolved()}
        </Scroll>
      </Show>
    </Show>
  );
}

function PanelFooter(props: SlotProps) {
  const resolved = children(() => props.children);
  return (
    <Show when={resolved()}>
      <div
        class={cn(
          'flex flex-none items-center min-h-10 px-2 border-t border-edge-muted overflow-hidden',
          props.class
        )}
        style={{ 'grid-area': 'footer' }}
      >
        {resolved()}
      </div>
    </Show>
  );
}

/**
 * A depth-aware container with fixed header, toolbar, and footer slots around
 * a body that absorbs the remaining height.
 *
 * @do Put controls in `Panel.Toolbar` and titles in `Panel.Header` so heights
 *   stay consistent across the app.
 * @do Set `depth` on the Panel rather than a background class on its children.
 * @do Use `Panel.Body scroll` instead of adding `overflow-auto` yourself.
 * @dont Do not nest a Panel inside `Panel.Body` just to get padding — use the
 *   body's own class.
 * @dont Do not give `Panel.Header` a custom height; the 40px minimum is what
 *   aligns panels side by side.
 */
export const Panel = Object.assign(PanelRoot, {
  Toolbar: PanelToolbar,
  Header: PanelHeader,
  Footer: PanelFooter,
  Body: PanelBody,
});
