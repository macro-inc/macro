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

// Focus ring painted on the group frame when a contained input-group control
// is focused; the borderless `ghost` frame opts out.
const groupFocusRing =
  'has-[[data-slot=input-group-control]:focus-visible]:border-[color-mix(in_oklch,var(--color-edge)_80%,var(--color-ink))] has-[[data-slot=input-group-control]:focus-visible]:ring-2 has-[[data-slot=input-group-control]:focus-visible]:ring-edge-muted';

/* Mirrors the glass rule in Button.tsx: the group carries the glass for the
   whole row, and a `ghost` group — a bare toolbar cluster with no surface of
   its own — stays flat, hover included. Kept local rather than imported so the
   Button <-> ButtonGroup dependency stays type-only. Literal class strings
   only — Tailwind's scanner can't see template-built classes. */
const glassClass = (variant: ButtonVariant): string => {
  if (variant === 'ghost') return '';
  return 'glass';
};

/** Canonical classes for the button-group frame. */
export const buttonGroupVariants = createVariants(
  cn(
    'inline-flex items-center justify-center overflow-hidden',
    'data-[orientation=horizontal]:flex-row',
    'data-[orientation=vertical]:flex-col',
    // strip per-button rounding + borders so the group owns the frame
    '**:data-button:rounded-none **:data-button:border-0'
  ),
  {
    variant: {
      danger: cn('border-1 border-failure/50', groupFocusRing),
      outline: cn('border-1 border-edge-muted', groupFocusRing),
      accent: cn('border-1 border-accent', groupFocusRing),
      success: cn('border-1 border-success', groupFocusRing),
      ghost: '',
      strong: cn('border-1 border-transparent', groupFocusRing),
      cta: cn('border-1 border-transparent', groupFocusRing),
    },
    // Explicit cross-axis size so the frame matches a standalone Button of the
    // same size (border-box absorbs the 1px frame); radius tracks size too.
    size: {
      xs: 'rounded-md',
      sm: 'rounded-md data-[orientation=horizontal]:h-6',
      md: 'rounded-md',
      lg: 'rounded-lg',
      xl: 'rounded-lg data-[orientation=horizontal]:h-12',
      'icon-xs':
        'rounded-md data-[orientation=horizontal]:h-5 data-[orientation=vertical]:w-5',
      'icon-sm':
        'rounded-md data-[orientation=horizontal]:h-6 data-[orientation=vertical]:w-6',
      'icon-md':
        'rounded-md data-[orientation=horizontal]:h-8 data-[orientation=vertical]:w-8',
      'icon-lg':
        'rounded-md data-[orientation=horizontal]:h-9 data-[orientation=vertical]:w-9',
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
      danger: 'bg-failure/50',
      outline: 'bg-edge-muted',
      accent: 'bg-accent',
      success: 'bg-success',
      ghost: 'bg-edge-muted',
      strong: 'bg-surface-4/50',
      cta: 'bg-surface/50',
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
            glassClass(props.variant ?? 'ghost'),
            props.class
          )}
          role="group"
        >
          {props.children}
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
