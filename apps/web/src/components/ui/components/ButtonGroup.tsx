import { createContext, type JSX, useContext } from 'solid-js';
import { cn } from '../utils/classname';
import type { ButtonSize, ButtonVariant } from './Button';
import { Layer } from './Layer';

type ButtonGroupOrientation = 'horizontal' | 'vertical';

type ButtonGroupContextValue = {
  depth?: 0 | 1 | 2 | 3 | 4;
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

const groupVariantStyles: Record<ButtonVariant, string> = {
  danger: 'border border-failure/50  ',
  base: 'border border-edge-muted  ',
  active: 'border border-accent  ',
  success: 'border border-success  ',
  ghost: '                          ',
  contrast: 'border border-transparent',
  cta: 'border border-transparent ',
};

/* Mirrors the glass mapping in Button.tsx: the group carries the glass for
   the whole row, sized like its buttons (compact sizes get `glass-sm`), and a
   `ghost` group — a bare toolbar cluster with no surface of its own — only
   picks it up on hover. Kept local rather than imported so the Button <->
   ButtonGroup dependency stays type-only. */
const glassSizeStyles: Record<ButtonSize, string> = {
  xs: 'glass-sm',
  'icon-xs': 'glass-sm',
  sm: 'glass-sm',
  'icon-sm': 'glass-sm',
  md: 'glass',
  'icon-md': 'glass',
  lg: 'glass',
  'icon-lg': 'glass',
};

// Literal strings only — Tailwind's scanner can't see template-built classes.
const ghostGlassSizeStyles: Record<ButtonSize, string> = {
  xs: 'hover:glass-sm',
  'icon-xs': 'hover:glass-sm',
  sm: 'hover:glass-sm',
  'icon-sm': 'hover:glass-sm',
  md: 'hover:glass',
  'icon-md': 'hover:glass',
  lg: 'hover:glass',
  'icon-lg': 'hover:glass',
};

const glassClass = (variant: ButtonVariant, size: ButtonSize): string =>
  variant === 'ghost' ? ghostGlassSizeStyles[size] : glassSizeStyles[size];

const dividerVariantStyles: Record<ButtonVariant, string> = {
  danger: 'bg-failure/50',
  base: 'bg-edge-muted',
  active: 'bg-accent',
  success: 'bg-success',
  ghost: 'bg-edge-muted',
  contrast: 'bg-surface/50',
  cta: 'bg-surface/50',
};

/* explicit cross-axis size so the group's outer box matches a standalone
   Button of the same size (border-box absorbs the 1px outer border) */
const groupHorizontalSize: Record<ButtonSize, string> = {
  xs: '',
  'icon-xs': 'h-5',
  lg: '',
  md: '',
  sm: 'h-6',
  'icon-lg': 'h-11',
  'icon-md': 'h-9',
  'icon-sm': 'h-6',
};

const groupVerticalSize: Record<ButtonSize, string> = {
  xs: '',
  'icon-xs': 'w-5',
  lg: '',
  md: '',
  sm: '',
  'icon-lg': 'w-11',
  'icon-md': 'w-9',
  'icon-sm': 'w-6',
};

export const ButtonGroup = (props: ButtonGroupProps) => {
  const orientation = () => props.orientation ?? 'horizontal';
  const variant = () => props.variant ?? 'ghost';
  const sizeClass = () => {
    if (!props.size) return '';
    return orientation() === 'horizontal'
      ? groupHorizontalSize[props.size]
      : groupVerticalSize[props.size];
  };

  const ctx: ButtonGroupContextValue = {
    get depth() {
      return props.depth;
    },
    get variant() {
      return props.variant;
    },
    get size() {
      return props.size;
    },
    get orientation() {
      return orientation();
    },
  };

  return (
    <ButtonGroupContext.Provider value={ctx}>
      <Layer depth={props.depth ?? 0}>
        <div
          data-orientation={orientation()}
          class={cn(
            'data-[orientation=horizontal]:flex-row items-center',
            'data-[orientation=vertical]:flex-col justify-center',
            'inline-flex overflow-hidden rounded-sm',
            /* the group is the pane of glass — its buttons opt out (see
               Button.tsx) so the row reads as one surface, not N chips */
            glassClass(variant(), props.size ?? 'md'),
            /* strip per-button rounding + borders so the group owns the frame */
            '**:data-button:rounded-none',
            '**:data-button:border-0',
            groupVariantStyles[variant()],
            sizeClass(),
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
  const variant = () => group?.variant ?? 'base';
  return (
    <div
      role="separator"
      aria-orientation={orientation()}
      data-orientation={orientation()}
      class={cn(
        'shrink-0 self-stretch',
        'data-[orientation=horizontal]:w-px',
        'data-[orientation=vertical]:h-px',
        dividerVariantStyles[variant()],
        props.class
      )}
    />
  );
};

ButtonGroup.Divider = Divider;
