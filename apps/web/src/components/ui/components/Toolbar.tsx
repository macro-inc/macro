import { createContext, type JSX, splitProps, useContext } from 'solid-js';
import { cn } from '../utils/classname';
import {
  Button,
  type ButtonProps,
  type ButtonSize,
  type ButtonVariant,
} from './Button';
import { Layer } from './Layer';

type ToolbarOrientation = 'horizontal' | 'vertical';

type ToolbarContextValue = {
  size: ButtonSize;
  variant: ButtonVariant;
  orientation: ToolbarOrientation;
};

const ToolbarContext = createContext<ToolbarContextValue>();

const useToolbarContext = () => useContext(ToolbarContext);

export type ToolbarProps = Omit<JSX.HTMLAttributes<HTMLDivElement>, 'style'> & {
  depth?: 0 | 1 | 2 | 3 | 4;
  orientation?: ToolbarOrientation;
  /** Default size for `Toolbar.Button` children. Defaults to `md`. */
  size?: ButtonSize;
  /** Default variant for `Toolbar.Button` children. Defaults to `ghost`. */
  variant?: ButtonVariant;
  style?: JSX.CSSProperties;
};

/**
 * An opinionated floating bar of controls. Owns its surface chrome
 * (`rounded-xl`, padding, border, background, shadow) and sets the default
 * size/variant for its `Toolbar.Button` children, so callers compose controls
 * without restyling them. Pair with a positioning wrapper (e.g.
 * `PopupPositioner`) when it needs to float against an anchor.
 *
 * @do Cluster related controls with `Toolbar.Group` and separate distinct
 *   action sets with `Toolbar.Divider`.
 * @do Set shared button size and variant on the Toolbar root.
 * @dont Do not recreate the toolbar's background, border, padding, or shadow
 *   at the call site.
 */
export function Toolbar(props: ToolbarProps) {
  const [local, rest] = splitProps(props, [
    'children',
    'class',
    'depth',
    'orientation',
    'size',
    'variant',
  ]);

  const ctx: ToolbarContextValue = {
    get size() {
      return local.size ?? 'md';
    },
    get variant() {
      return local.variant ?? 'ghost';
    },
    get orientation() {
      return local.orientation ?? 'horizontal';
    },
  };

  return (
    <ToolbarContext.Provider value={ctx}>
      <Layer depth={local.depth ?? 2}>
        <div
          data-slot="toolbar"
          data-orientation={ctx.orientation}
          role="toolbar"
          aria-orientation={ctx.orientation}
          class={cn(
            'inline-flex items-center gap-1 rounded-xl border border-edge bg-surface p-1.5 shadow-lg',
            'data-[orientation=vertical]:flex-col data-[orientation=vertical]:items-stretch',
            local.class
          )}
          {...rest}
        >
          {local.children}
        </div>
      </Layer>
    </ToolbarContext.Provider>
  );
}

export type ToolbarButtonProps = ButtonProps;

/** A `Button` that inherits the toolbar's default size and variant. */
function ToolbarButton(props: ToolbarButtonProps) {
  const ctx = useToolbarContext();
  const [local, rest] = splitProps(props, ['size', 'variant']);

  return (
    <Button
      size={local.size ?? ctx?.size ?? 'md'}
      variant={local.variant ?? ctx?.variant ?? 'ghost'}
      {...rest}
    />
  );
}

export type ToolbarGroupProps = {
  children?: JSX.Element;
  class?: string;
};

/** Clusters related controls with tighter spacing inside a toolbar. */
function ToolbarGroup(props: ToolbarGroupProps) {
  const ctx = useToolbarContext();
  const orientation = () => ctx?.orientation ?? 'horizontal';

  return (
    <div
      role="group"
      data-slot="toolbar-group"
      data-orientation={orientation()}
      class={cn(
        'inline-flex items-center gap-0.5',
        'data-[orientation=vertical]:flex-col data-[orientation=vertical]:items-stretch',
        props.class
      )}
    >
      {props.children}
    </div>
  );
}

export type ToolbarDividerProps = {
  class?: string;
};

/** A separator between toolbar clusters, matched to the toolbar orientation. */
function ToolbarDivider(props: ToolbarDividerProps) {
  const ctx = useToolbarContext();
  const orientation = () => ctx?.orientation ?? 'horizontal';

  return (
    <div
      role="separator"
      aria-orientation={
        orientation() === 'horizontal' ? 'vertical' : 'horizontal'
      }
      data-orientation={orientation()}
      class={cn(
        'shrink-0 self-stretch bg-edge-muted',
        'data-[orientation=horizontal]:mx-0.5 data-[orientation=horizontal]:my-1 data-[orientation=horizontal]:w-px',
        'data-[orientation=vertical]:my-0.5 data-[orientation=vertical]:mx-1 data-[orientation=vertical]:h-px',
        props.class
      )}
    />
  );
}

/** Pushes subsequent controls to the far end of the toolbar. */
function ToolbarSpacer() {
  return <div data-slot="toolbar-spacer" class="grow" />;
}

Toolbar.Button = ToolbarButton;
Toolbar.Group = ToolbarGroup;
Toolbar.Divider = ToolbarDivider;
Toolbar.Spacer = ToolbarSpacer;
