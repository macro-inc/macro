import { isMobileWidth } from '@core/mobile/mobileWidth';
import Resizable, { type ContextValue } from '@corvu/resizable';
import {
  createEffect,
  type JSX,
  Match,
  type ParentProps,
  Show,
  Switch,
  splitProps,
} from 'solid-js';

function ContextWrapper(
  props: ParentProps<{
    setResizableContext?: (context: ContextValue) => void;
  }>
) {
  const context = Resizable.useContext();
  createEffect(() => {
    props.setResizableContext?.(context);
  });
  return props.children;
}

/**
 * @file This is a drop-in replacement for Resizable that by-passes Resizable componenets at mobile width, to allow for correct responsive styling.
 */

type ResponsiveResizableProps = ParentProps<{
  class?: string;
  style?: JSX.CSSProperties;
  setResizableContext?: (context: ContextValue) => void;
  [key: string]: any;
}>;

export function ResponsiveResizable(props: ResponsiveResizableProps) {
  const [local, resizableProps] = splitProps(props, [
    'children',
    'class',
    'style',
    'setResizableContext',
  ]);
  // wrap the resizables in a component that either returns a resizable or a div, rather than switch match ugly mayhem
  return (
    <Switch>
      <Match when={isMobileWidth()}>
        <div class={local.class} style={local.style}>
          {local.children}
        </div>
      </Match>
      <Match when={!isMobileWidth()}>
        <Resizable class={local.class} style={local.style} {...resizableProps}>
          <ContextWrapper setResizableContext={local.setResizableContext}>
            {local.children}
          </ContextWrapper>
        </Resizable>
      </Match>
    </Switch>
  );
}

type PanelProps = ParentProps<{
  class?: string;
  style?: JSX.CSSProperties;
  [key: string]: any;
}>;

ResponsiveResizable.Panel = function Panel(props: PanelProps) {
  const [local, panelProps] = splitProps(props, ['children', 'class', 'style']);

  return (
    <Switch>
      <Match when={isMobileWidth()}>
        <div class={local.class} style={local.style}>
          {local.children}
        </div>
      </Match>
      <Match when={!isMobileWidth()}>
        <Resizable.Panel
          class={local.class}
          style={local.style}
          {...panelProps}
        >
          {local.children}
        </Resizable.Panel>
      </Match>
    </Switch>
  );
};

// Handle component for ResponsiveResizable
type HandleProps = ParentProps<{
  class?: string;
  'aria-label'?: string;
  [key: string]: any;
}>;

ResponsiveResizable.Handle = function Handle(props: HandleProps) {
  const [local, handleProps] = splitProps(props, [
    'class',
    'aria-label',
    'children',
  ]);

  return (
    <Show when={!isMobileWidth()}>
      <Resizable.Handle
        aria-label={local['aria-label'] || 'Resize Handle'}
        class={local.class}
        {...handleProps}
      >
        {props.children}
      </Resizable.Handle>
    </Show>
  );
};
