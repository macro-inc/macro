import {
  type ComponentProps,
  createContext,
  splitProps,
  useContext,
  type ValidComponent,
} from 'solid-js';
import { cn } from '../utils/classname';
import {
  Button,
  type ButtonFinish,
  type ButtonProps,
  type ButtonSize,
  type ButtonVariant,
  buttonFrameClasses,
} from './Button';

type ButtonGroupOrientation = 'horizontal' | 'vertical';
type ButtonGroupContextValue = {
  variant: ButtonVariant;
  size: ButtonSize;
  orientation: ButtonGroupOrientation;
};

const ButtonGroupContext = createContext<ButtonGroupContextValue>();
export const useButtonGroupContext = () => useContext(ButtonGroupContext);

export type ButtonGroupProps = Omit<ComponentProps<'div'>, 'size'> & {
  variant?: ButtonVariant;
  /** The shared frame adapts by default; segments always stay flat. */
  finish?: ButtonFinish;
  size?: ButtonSize;
  orientation?: ButtonGroupOrientation;
};

/** Layout only; Button owns the frame's colors, border, and optional finish. */
export const buttonGroupVariants =
  'inline-flex items-stretch justify-center rounded-full border data-[orientation=horizontal]:flex-row data-[orientation=vertical]:flex-col has-[[data-slot=input-group-control]:focus-visible]:ring-2 has-[[data-slot=input-group-control]:focus-visible]:ring-button-focus';
export const buttonGroupDividerVariants =
  'shrink-0 self-stretch bg-divider data-[orientation=horizontal]:w-px data-[orientation=vertical]:h-px';

export function ButtonGroup(props: ButtonGroupProps) {
  const [local, rest] = splitProps(props, [
    'variant',
    'finish',
    'size',
    'orientation',
    'class',
    'children',
  ]);
  const variant = () => local.variant ?? 'secondary';
  const size = () => local.size ?? 'md';
  const orientation = () => local.orientation ?? 'horizontal';
  const context: ButtonGroupContextValue = {
    get variant() {
      return variant();
    },
    get size() {
      return size();
    },
    get orientation() {
      return orientation();
    },
  };

  return (
    <ButtonGroupContext.Provider value={context}>
      <div
        {...rest}
        data-slot="button-group"
        data-orientation={orientation()}
        data-size={size()}
        data-variant={variant()}
        data-finish={local.finish}
        class={cn(
          buttonGroupVariants,
          buttonFrameClasses({ variant: variant(), finish: local.finish }),
          local.class
        )}
        role="group"
      >
        <div class="flex min-w-0 flex-1 items-stretch justify-center overflow-hidden rounded-[inherit] [flex-direction:inherit]">
          {local.children}
        </div>
      </div>
    </ButtonGroupContext.Provider>
  );
}

/** Only explicit segments inherit the group; ordinary Buttons remain independent. */
function GroupButton<T extends ValidComponent = 'button'>(
  props: ButtonProps<T>
) {
  const group = useButtonGroupContext();
  const [local, rest] = splitProps(props as ButtonProps, [
    'variant',
    'finish',
    'size',
    'class',
  ]);
  const variant = () => local.variant ?? group?.variant ?? 'primary';

  return (
    <Button
      {...rest}
      data-button-group-button=""
      variant={variant()}
      size={local.size ?? group?.size}
      finish={group ? 'flat' : local.finish}
      class={cn(
        group && 'self-stretch rounded-none border-0 shadow-none',
        group && variant() === group.variant && 'bg-transparent',
        group?.orientation === 'vertical' && 'w-full',
        local.class
      )}
    />
  );
}

function Divider(props: { class?: string }) {
  const group = useButtonGroupContext();
  const orientation = () => group?.orientation ?? 'horizontal';
  return (
    <div
      role="separator"
      aria-orientation={orientation()}
      data-orientation={orientation()}
      class={cn(buttonGroupDividerVariants, props.class)}
    />
  );
}

ButtonGroup.Button = GroupButton;
ButtonGroup.Divider = Divider;
