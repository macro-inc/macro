import { createContext, type JSX, useContext } from 'solid-js';
import { cn } from '../utils/classname';
import { createVariants } from '../utils/variants';
import type { ButtonSize, ButtonVariant } from './Button';
import { Layer } from './Layer';

type ButtonGroupOrientation = 'horizontal' | 'vertical';

type ButtonGroupContextValue = {
  variant?: ButtonVariant;
  size?: ButtonSize;
  orientation: ButtonGroupOrientation;
};

const ButtonGroupContext = createContext<ButtonGroupContextValue | undefined>(
  undefined
);

export const useButtonGroupContext = () => useContext(ButtonGroupContext);

type ButtonGroupProps = {
  depth?: 0 | 1 | 2 | 3 | 4;
  variant?: ButtonVariant;
  size?: ButtonSize;
  orientation?: ButtonGroupOrientation;
  class?: string;
  children?: JSX.Element;
};

/** Canonical classes for the button-group frame. */
export const buttonGroupVariants = createVariants(
  cn(
    'inline-flex items-center justify-center rounded-[10px] data-[orientation=horizontal]:rounded-full border border-edge-button bg-control',
    'has-[[data-slot=input-group-control]:focus-visible]:ring-2 has-[[data-slot=input-group-control]:focus-visible]:ring-edge-muted',
    'has-[[data-slot=input-group-control]]:rounded-full',
    'data-[orientation=horizontal]:flex-row',
    'data-[orientation=vertical]:flex-col',
    // strip per-button rounding + borders so the group owns the frame
    '**:data-button:rounded-none **:data-button:border-0'
  ),
  {
    variant: {
      danger: '',
      outline: '',
      accent: '',
      success: '',
      ghost: '',
      plain: 'border-0 bg-transparent',
      strong: '',
      cta: '',
      navigation: 'border-transparent bg-transparent',
    },
    // Explicit cross-axis size so the frame matches a standalone Button of the
    // same size (border-box absorbs the 1px frame); radius tracks size too.
    size: {
      xs: '',
      sm: 'data-[orientation=horizontal]:h-6',
      md: '',
      lg: '',
      xl: 'data-[orientation=horizontal]:h-12',
      'icon-xs':
        'data-[orientation=horizontal]:h-5 data-[orientation=vertical]:w-5',
      'icon-sm':
        'data-[orientation=horizontal]:h-6 data-[orientation=vertical]:w-6',
      'icon-composer':
        'data-[orientation=horizontal]:h-6 data-[orientation=vertical]:w-6 not-touch:data-[orientation=horizontal]:h-[33.75px] not-touch:data-[orientation=vertical]:w-[33.75px]',
      'icon-md':
        'data-[orientation=horizontal]:h-8 data-[orientation=vertical]:w-8',
      'icon-lg':
        'rounded-xl data-[orientation=horizontal]:h-9 data-[orientation=vertical]:w-9',
    },
  },
  {
    variant: 'ghost',
    size: 'md',
  }
);

/** Divider frame classes; `variant` picks the rule color. */
export const buttonGroupDividerVariants = createVariants(
  cn(
    'shrink-0 self-stretch',
    'data-[orientation=horizontal]:w-px',
    'data-[orientation=vertical]:h-px'
  ),
  {
    variant: {
      danger: 'bg-edge-divider',
      outline: 'bg-edge-divider',
      accent: 'bg-edge-divider',
      success: 'bg-edge-divider',
      ghost: 'bg-edge-divider',
      plain: 'bg-edge-divider',
      strong: 'bg-edge-divider',
      cta: 'bg-edge-divider',
      navigation: 'bg-edge-divider',
    },
  },
  {
    variant: 'outline',
  }
);

export const ButtonGroup = (props: ButtonGroupProps) => {
  const orientation = () => props.orientation ?? 'horizontal';
  const size = () => props.size ?? 'md';

  const ctx: ButtonGroupContextValue = {
    get variant() {
      return props.variant;
    },
    get size() {
      return size();
    },
    get orientation() {
      return orientation();
    },
  };

  return (
    <ButtonGroupContext.Provider value={ctx}>
      <Layer depth={props.depth ?? 0}>
        <div
          data-slot="button-group"
          data-orientation={orientation()}
          data-size={size()}
          class={cn(
            buttonGroupVariants({ variant: props.variant, size: props.size }),
            props.class
          )}
          role="group"
        >
          {/* Clip the segments independently of the group frame. */}
          <div class="flex size-full min-w-0 items-center justify-center overflow-hidden rounded-[inherit] [flex-direction:inherit]">
            {props.children}
          </div>
        </div>
      </Layer>
    </ButtonGroupContext.Provider>
  );
};

type DividerProps = { class?: string };

const Divider = (props: DividerProps) => {
  const group = useButtonGroupContext();
  const orientation = () => group?.orientation ?? 'horizontal';
  return (
    <div
      role="separator"
      aria-orientation={orientation()}
      data-orientation={orientation()}
      class={cn(
        buttonGroupDividerVariants({ variant: group?.variant }),
        props.class
      )}
    />
  );
};

ButtonGroup.Divider = Divider;
