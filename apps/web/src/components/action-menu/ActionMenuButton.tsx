import { isTouchDevice } from '@core/mobile/isTouchDevice';
import CaretRight from '@phosphor/caret-right.svg';
import DotsThree from '@phosphor/dots-three.svg';
import { Button, cn, Dropdown } from '@ui';
import { For, type JSX, Match, Show, Switch } from 'solid-js';
import { ActionMenuDrawer } from './ActionMenuDrawer';
import {
  type ActionMenuSection,
  type ActionMenuState,
  useProvidedActionMenu,
} from './action-menu-context';

function DropdownEntries(props: {
  sections: ActionMenuSection[];
  onSelect: () => void;
}) {
  return (
    <For each={props.sections}>
      {(section) => (
        <Dropdown.Group>
          <For each={section.entries}>
            {(entry) => (
              <Switch>
                <Match when={entry.kind === 'item' && entry}>
                  {(item) => (
                    <Dropdown.Item
                      class="[&>svg]:size-4 [&>svg]:shrink-0"
                      disabled={item().disabled()}
                      onSelect={() => {
                        item().onSelect();
                        props.onSelect();
                      }}
                    >
                      {item().content()}
                    </Dropdown.Item>
                  )}
                </Match>
                <Match when={entry.kind === 'sub' && entry}>
                  {(sub) => (
                    <Dropdown.Sub>
                      <Dropdown.SubTrigger class="[&>svg]:size-4 [&>svg]:shrink-0">
                        {sub().label()}
                        <CaretRight class="size-3.5 shrink-0" />
                      </Dropdown.SubTrigger>
                      <Dropdown.SubContent>
                        <DropdownEntries
                          sections={sub().sections()}
                          onSelect={props.onSelect}
                        />
                      </Dropdown.SubContent>
                    </Dropdown.Sub>
                  )}
                </Match>
              </Switch>
            )}
          </For>
        </Dropdown.Group>
      )}
    </For>
  );
}

export type ActionMenuButtonProps = {
  /** Another Root's menu to render instead of the enclosing one. */
  menu?: ActionMenuState;
  /** Accessible name for the button and the sheet. */
  label?: string;
  triggerClass?: string;
  contentClass?: string;
  /** Items that exist only while the menu is open. */
  children?: JSX.Element;
};

/** A dots button opening a dropdown, or a bottom sheet on touch devices. */
export function ActionMenuButton(props: ActionMenuButtonProps) {
  const menu = useProvidedActionMenu(() => props.menu);
  const label = () => props.label ?? 'Actions';

  return (
    <Switch>
      <Match when={isTouchDevice()}>
        <Button
          size="icon-sm"
          variant="ghost"
          class={props.triggerClass}
          label={label()}
          onClick={() => menu().setOpen(true)}
        >
          <DotsThree />
        </Button>
        <ActionMenuDrawer menu={menu()} label={label()}>
          {props.children}
        </ActionMenuDrawer>
      </Match>
      <Match when={true}>
        <Dropdown
          open={menu().open()}
          onOpenChange={(open) => menu().setOpen(open)}
        >
          <Dropdown.Trigger
            class={props.triggerClass}
            size="icon-sm"
            variant="ghost"
            label={label()}
          >
            <DotsThree />
          </Dropdown.Trigger>
          <Show when={menu().open()}>{props.children}</Show>
          <Dropdown.Content class={cn('w-64', props.contentClass)}>
            <DropdownEntries
              sections={menu().sections()}
              onSelect={() => menu().setOpen(false)}
            />
          </Dropdown.Content>
        </Dropdown>
      </Match>
    </Switch>
  );
}
