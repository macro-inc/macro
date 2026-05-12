import { type JSX, createContext, useContext } from 'solid-js';
import type { ButtonSize, ButtonVariant } from './Button';
import { cn } from '../utils/classname';
import { Layer } from './Layer';

type ButtonGroupOrientation = 'horizontal' | 'vertical';

type ButtonGroupContextValue = {
  depth?: 0 | 1 | 2 | 3 | 4 | 5;
  variant?: ButtonVariant;
  size?: ButtonSize;
  orientation: ButtonGroupOrientation;
};

const ButtonGroupContext = createContext<ButtonGroupContextValue | undefined>(undefined);

export const useButtonGroupContext = () => useContext(ButtonGroupContext);

type ButtonGroupProps = {
  depth?: 0 | 1 | 2 | 3 | 4 | 5;
  variant?: ButtonVariant;
  size?: ButtonSize;
  orientation?: ButtonGroupOrientation;
  class?: string;
  children?: JSX.Element;
};

const groupVariantStyles: Record<ButtonVariant, string> = {
  danger: 'border border-failure/50  ',
  base:   'border border-edge-muted  ',
  active: 'border border-accent-ink  ',
  ghost:  '                          ',
};

const dividerVariantStyles: Record<ButtonVariant, string> = {
  danger: 'bg-failure/50',
  base:   'bg-edge-muted',
  active: 'bg-accent-ink',
  ghost:  'bg-edge-muted',
};

/* explicit cross-axis size so the group's outer box matches a standalone
   Button of the same size (border-box absorbs the 1px outer border) */
const groupHorizontalSize: Record<ButtonSize, string> = {
  'lg':      '',
  'md':      '',
  'sm':      'h-6',
  'icon-lg': 'h-11',
  'icon-md': 'h-9',
  'icon-sm': 'h-6',
};

const groupVerticalSize: Record<ButtonSize, string> = {
  'lg':      '',
  'md':      '',
  'sm':      '',
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
      get depth() { return props.depth; },
      get variant() { return props.variant; },
      get size() { return props.size; },
      get orientation() { return orientation(); },
    };

  return (
      <ButtonGroupContext.Provider value={ctx}>
        <Layer depth={props.depth ?? 0}>
          <div
            role="group"
            data-orientation={orientation()}
            class={cn(
              'inline-flex overflow-hidden rounded-sm',
              'data-[orientation=horizontal]:flex-row items-center',
              'data-[orientation=vertical]:flex-col justify-center',
              /* strip per-button rounding + borders so the group owns the frame */
              '[&_[data-button]]:rounded-none',
              '[&_[data-button]]:border-0',
              sizeClass(),
              groupVariantStyles[variant()],
              props.class
            )}
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
