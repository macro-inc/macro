import { MobileDrawer } from '@components/app/mobile/MobileDrawer';
import CaretDown from '@phosphor/caret-down.svg';
import CaretRight from '@phosphor/caret-right.svg';
import { cn } from '@ui';
import { createSignal, For, type JSX, Match, Show, Switch } from 'solid-js';
import { Dynamic } from 'solid-js/web';
import {
  type ActionMenuEntry,
  type ActionMenuState,
  type ActionMenuSubEntry,
  useProvidedActionMenu,
} from './action-menu-context';

function DrawerEntry(props: {
  entry: ActionMenuEntry;
  nested?: boolean;
  onSelect: () => void;
}) {
  const padding = () => (props.nested ? 'pl-9 pr-4' : 'px-4');

  return (
    <Switch>
      <Match when={props.entry.kind === 'item' && props.entry}>
        {(item) => (
          <MobileDrawer.Item
            class={cn(padding(), '[&>svg]:size-4 [&>svg]:shrink-0')}
            disabled={item().disabled()}
            onClick={(event) => {
              item().onSelect(event);
              props.onSelect();
            }}
          >
            {item().content()}
          </MobileDrawer.Item>
        )}
      </Match>
      <Match when={props.entry.kind === 'sub' && props.entry}>
        {(sub) => (
          <DrawerSub
            sub={sub()}
            nested={props.nested}
            onSelect={props.onSelect}
          />
        )}
      </Match>
    </Switch>
  );
}

/** Expands in place; nested entries render flat under the row. */
function DrawerSub(props: {
  sub: ActionMenuSubEntry;
  nested?: boolean;
  onSelect: () => void;
}) {
  const [expanded, setExpanded] = createSignal(false);
  const entries = () =>
    props.sub.sections().flatMap((section) => section.entries);

  return (
    <div class="w-full">
      <MobileDrawer.Item
        class={cn(
          props.nested ? 'pl-9 pr-4' : 'px-4',
          '[&>svg]:size-4 [&>svg]:shrink-0'
        )}
        aria-expanded={expanded()}
        onClick={() => setExpanded((value) => !value)}
      >
        {props.sub.label()}
        <Dynamic
          component={expanded() ? CaretDown : CaretRight}
          class="size-3.5 shrink-0"
        />
      </MobileDrawer.Item>
      <Show when={expanded()}>
        <div class="pt-1">
          <For each={entries()}>
            {(entry) => (
              <DrawerEntry entry={entry} nested onSelect={props.onSelect} />
            )}
          </For>
        </div>
      </Show>
    </div>
  );
}

export type ActionMenuDrawerProps = {
  /** Another Root's menu to render instead of the enclosing one. */
  menu?: ActionMenuState;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Accessible name for the sheet. */
  label?: string;
  /** Pinned above the sections, e.g. the entity the actions apply to. */
  header?: JSX.Element;
  /** Items that exist only while the sheet is open. */
  children?: JSX.Element;
};

/** Bottom sheet listing the sections. Follows the menu's open state unless controlled. */
export function ActionMenuDrawer(props: ActionMenuDrawerProps) {
  const menu = useProvidedActionMenu(() => props.menu);
  const open = () => props.open ?? menu().open();
  const setOpen = (value: boolean) => {
    if (props.onOpenChange) {
      props.onOpenChange(value);
    } else {
      menu().setOpen(value);
    }
  };

  return (
    <MobileDrawer
      side="bottom"
      open={open()}
      onOpenChange={setOpen}
      preventScroll={false}
      preventScrollbarShift={false}
    >
      <Show when={open()}>{props.children}</Show>
      <MobileDrawer.Portal>
        <MobileDrawer.Overlay />
        <MobileDrawer.Content aria-label={props.label ?? 'Actions'}>
          <MobileDrawer.Handle />
          {props.header}
          <MobileDrawer.ScrollBody>
            <For each={menu().sections()}>
              {(section, index) => (
                <>
                  <Show when={index() > 0}>
                    <div class="mt-3" />
                  </Show>
                  <MobileDrawer.Section class="flex flex-col shrink-0">
                    <For each={section.entries}>
                      {(entry) => (
                        <DrawerEntry
                          entry={entry}
                          onSelect={() => setOpen(false)}
                        />
                      )}
                    </For>
                  </MobileDrawer.Section>
                </>
              )}
            </For>
          </MobileDrawer.ScrollBody>
        </MobileDrawer.Content>
      </MobileDrawer.Portal>
    </MobileDrawer>
  );
}
