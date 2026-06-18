import { hapticImpact } from '@core/mobile/haptics';
import CaretDownIcon from '@phosphor/caret-down.svg';
import CheckIcon from '@phosphor/check.svg';
import { Dropdown } from '@ui';
import {
  type Component,
  For,
  type JSX,
  type ParentProps,
  Show,
} from 'solid-js';
import { Dynamic } from 'solid-js/web';

export type HeaderTitleMenuItem = {
  value: string;
  label: JSX.Element | string;
  icon?: Component<JSX.SvgSVGAttributes<SVGSVGElement>>;
};

/**
 * Mobile header pattern: the title island doubles as a view switcher.
 * Children render as the dropdown trigger (icon + title) followed by a
 * caret; the menu lists the block's views with a check on the active one.
 * Used in place of header/toolbar tabs, which are hidden on mobile.
 */
export function HeaderTitleMenu(
  props: ParentProps<{
    items: readonly HeaderTitleMenuItem[];
    active?: string;
    onSelect: (value: string) => void;
  }>
) {
  return (
    <Dropdown placement="bottom-start">
      <Dropdown.Trigger class="ph-no-capture h-8 max-w-full min-w-0 gap-1.5 border-none bg-transparent px-1 text-ink mobile:active:bg-transparent">
        {props.children}
        <CaretDownIcon class="size-3 shrink-0 text-ink-muted" />
      </Dropdown.Trigger>
      <Dropdown.Content depth={3} class="shadow-md">
        <Dropdown.Group>
          <For each={[...props.items]}>
            {(item) => (
              <Dropdown.Item
                class="h-10 min-w-44 text-sm"
                onSelect={() => {
                  hapticImpact('light');
                  props.onSelect(item.value);
                }}
              >
                <Show when={item.icon}>
                  {(icon) => (
                    <Dynamic
                      component={icon()}
                      class="size-4 shrink-0 text-ink-muted"
                    />
                  )}
                </Show>
                <span>{item.label}</span>
                <Show when={props.active === item.value}>
                  <CheckIcon class="ml-auto size-3.5 shrink-0 text-accent" />
                </Show>
              </Dropdown.Item>
            )}
          </For>
        </Dropdown.Group>
      </Dropdown.Content>
    </Dropdown>
  );
}
