import { createContext, type JSX, useContext } from 'solid-js';
import { cn } from '../utils/classname';
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

const groupVariantStyles: Record<ButtonVariant, string> = {
  danger: 'border border-failure/50  ',
  outline: 'border border-edge-muted  ',
  accent: 'border border-accent  ',
  success: 'border border-success  ',
  ghost: '                          ',
  strong: 'border border-transparent',
  cta: 'border border-transparent ',
};

const dividerVariantStyles: Record<ButtonVariant, string> = {
  danger: 'bg-failure/50',
  outline: 'bg-edge-muted',
  accent: 'bg-accent',
  success: 'bg-success',
  ghost: 'bg-edge-muted',
  strong: 'bg-surface-4/50',
  cta: 'bg-surface/50',
};

/* explicit cross-axis size so the group's outer box matches a standalone
   Button of the same size (border-box absorbs the 1px outer border) */
const groupHorizontalSize: Record<ButtonSize, string> = {
  xs: '',
  'icon-xs': 'h-5',
  xl: 'h-12',
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
  xl: '',
  lg: '',
  md: '',
  sm: '',
  'icon-lg': 'w-11',
  'icon-md': 'w-9',
  'icon-sm': 'w-6',
};

const groupRadius: Record<ButtonSize, string> = {
  xs: 'rounded-md',
  'icon-xs': 'rounded-md',
  sm: 'rounded-md',
  'icon-sm': 'rounded-md',
  md: 'rounded-md',
  'icon-md': 'rounded-md',
  lg: 'rounded-lg',
  'icon-lg': 'rounded-md',
  xl: 'rounded-lg',
};

export const ButtonGroup = (props: ButtonGroupProps) => {
  const orientation = () => props.orientation ?? 'horizontal';
  const variant = () => props.variant ?? 'ghost';
  const size = () => props.size ?? 'md';
  const sizeClass = () => {
    return orientation() === 'horizontal'
      ? groupHorizontalSize[size()]
      : groupVerticalSize[size()];
  };

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
            'data-[orientation=horizontal]:flex-row items-center',
            'data-[orientation=vertical]:flex-col justify-center',
            'inline-flex overflow-hidden',
            /* strip per-button rounding + borders so the group owns the frame */
            '**:data-button:rounded-none',
            '**:data-button:border-0',
            groupVariantStyles[variant()],
            variant() !== 'ghost' &&
              'has-[[data-slot=input-group-control]:focus-visible]:border-[color-mix(in_oklch,var(--color-edge)_80%,var(--color-ink))] has-[[data-slot=input-group-control]:focus-visible]:ring-2 has-[[data-slot=input-group-control]:focus-visible]:ring-edge-muted',
            groupRadius[size()],
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
  const variant = () => group?.variant ?? 'outline';
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
