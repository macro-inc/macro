import { Button as KobalteButton } from '@kobalte/core/button';
import { callHandler, type OverrideProps } from '@kobalte/utils';
import { type ComponentProps, splitProps, type ValidComponent } from 'solid-js';
import { createStore } from 'solid-js/store';
import { Dynamic } from 'solid-js/web';
import { cn } from '../utils/classname';
import { Surface, type SurfaceProps } from './Surface';

function MenuPart<T extends ValidComponent>(
  props: OverrideProps<
    ComponentProps<T>,
    {
      component: T;
      kind: 'row' | 'group' | 'label';
      class?: string;
    }
  >
) {
  const [local, rest] = splitProps(props, ['component', 'kind', 'class']);
  return (
    <Dynamic<ValidComponent>
      component={local.component}
      {...rest}
      class={cn(
        local.kind === 'row' &&
          'group rounded-lg w-full flex items-center gap-1.5 p-1.5 px-2 text-left font-normal cursor-default outline-none data-highlighted:bg-ink/5 data-disabled:opacity-50 data-disabled:cursor-not-allowed',
        local.kind === 'group' && 'flex flex-col p-1.5',
        local.kind === 'label' &&
          'px-2 h-7 flex items-center text-xs text-ink-extra-muted',
        local.class
      )}
    />
  );
}

function MenuSurface(props: SurfaceProps) {
  const [local, rest] = splitProps(props, ['class', 'depth']);
  return (
    <Surface
      depth={local.depth ?? 2}
      hideBorder
      {...rest}
      class={cn(
        'menu-surface rounded-xl size-auto z-action-menu menu-open-animation text-sm',
        local.class
      )}
    />
  );
}

/** Native menu rows for searchable popovers without a dropdown collection. */
function MenuItem(props: ComponentProps<'button'>) {
  const [local, rest] = splitProps(props, [
    'class',
    'disabled',
    'onFocus',
    'onBlur',
    'onPointerEnter',
    'onPointerLeave',
  ]);
  const [interaction, setInteraction] = createStore({
    focused: false,
    hovered: false,
  });
  return (
    <MenuPart<typeof KobalteButton>
      component={KobalteButton}
      kind="row"
      {...rest}
      disabled={local.disabled}
      data-disabled={local.disabled ? '' : undefined}
      data-highlighted={
        !local.disabled && (interaction.focused || interaction.hovered)
          ? ''
          : undefined
      }
      class={local.class}
      onFocus={(
        event: FocusEvent & {
          currentTarget: HTMLButtonElement;
          target: Element;
        }
      ) => {
        setInteraction('focused', true);
        callHandler(event, local.onFocus);
      }}
      onBlur={(
        event: FocusEvent & {
          currentTarget: HTMLButtonElement;
          target: Element;
        }
      ) => {
        setInteraction('focused', false);
        callHandler(event, local.onBlur);
      }}
      onPointerEnter={(
        event: PointerEvent & {
          currentTarget: HTMLButtonElement;
          target: Element;
        }
      ) => {
        setInteraction('hovered', event.pointerType !== 'touch');
        callHandler(event, local.onPointerEnter);
      }}
      onPointerLeave={(
        event: PointerEvent & {
          currentTarget: HTMLButtonElement;
          target: Element;
        }
      ) => {
        setInteraction('hovered', false);
        callHandler(event, local.onPointerLeave);
      }}
    />
  );
}

function MenuGroup(props: ComponentProps<'section'>) {
  return (
    <MenuPart<'section'>
      component="section"
      kind="group"
      role="group"
      {...props}
    />
  );
}

function MenuLabel(props: ComponentProps<'div'>) {
  return <MenuPart<'div'> component="div" kind="label" {...props} />;
}

export const Menu = {
  Part: MenuPart,
  Surface: MenuSurface,
  Item: MenuItem,
  Group: MenuGroup,
  Label: MenuLabel,
};
