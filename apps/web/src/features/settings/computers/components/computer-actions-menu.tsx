import { t } from '@app/lib/i18n';
import { MobileDrawer } from '@components/app/mobile/MobileDrawer';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import ArrowCounterClockwiseIcon from '@icon/system/regular/arrow-counter-clockwise.svg';
import SignInIcon from '@icon/system/regular/arrow-square-in.svg';
import SwitchIcon from '@icon/system/regular/arrows-left-right.svg';
import CalendarXIcon from '@icon/system/regular/calendar-x.svg';
import DotsThreeIcon from '@icon/system/regular/dots-three.svg';
import PowerIcon from '@icon/system/regular/power.svg';
import ShareIcon from '@icon/system/regular/share-network.svg';
import TrashIcon from '@icon/system/regular/trash.svg';
import type { Harness as RegisteredHarness } from '@service-storage/client';
import { Button, Dropdown, ToggleSwitch } from '@ui';
import { createSignal, For, getOwner, type JSX, Show } from 'solid-js';
import { match } from 'ts-pattern';
import {
  createBypassControl,
  OptionsHint,
} from '../../components/runtime-options';

export type ComputerMenuIcon =
  | 'share'
  | 'power'
  | 'sign-in'
  | 'credits'
  | 'cancel'
  | 'undo'
  | 'release';

export type ComputerMenuItem = {
  label: string;
  icon: ComputerMenuIcon;
  danger?: boolean;
  disabled?: boolean;
  onSelect: () => void;
};

function ItemIcon(props: { icon: ComputerMenuIcon }): JSX.Element {
  return match(props.icon)
    .with('share', () => <ShareIcon class="size-4" />)
    .with('power', () => <PowerIcon class="size-4" />)
    .with('sign-in', () => <SignInIcon class="size-4" />)
    .with('credits', () => <SwitchIcon class="size-4" />)
    .with('cancel', () => <CalendarXIcon class="size-4" />)
    .with('undo', () => <ArrowCounterClockwiseIcon class="size-4" />)
    .with('release', () => <TrashIcon class="size-4" />)
    .exhaustive();
}

type MenuProps = {
  name: string;
  share?: ComputerMenuItem;
  items: readonly ComputerMenuItem[];
  harness?: RegisteredHarness;
};

function DesktopItem(props: { item: ComputerMenuItem }) {
  return (
    <Dropdown.Item
      class={
        props.item.danger
          ? 'text-failure data-highlighted:bg-failure-bg'
          : undefined
      }
      disabled={props.item.disabled}
      onSelect={props.item.onSelect}
    >
      <ItemIcon icon={props.item.icon} />
      {props.item.label}
    </Dropdown.Item>
  );
}

// Sharing and the runtime's prompt policy first, then power and billing,
// with the destructive Release last.
function DesktopMenu(props: MenuProps) {
  return (
    <Dropdown placement="bottom-end">
      <Dropdown.Trigger
        aria-label={t('computers.more', { name: props.name })}
        variant="ghost"
        size="icon-md"
      >
        <DotsThreeIcon class="size-4" />
      </Dropdown.Trigger>
      <Dropdown.Content class="min-w-56 max-w-80">
        <Show when={props.share || props.harness}>
          <Dropdown.Group>
            <Show when={props.share}>
              {(share) => <DesktopItem item={share()} />}
            </Show>
            <Show when={props.harness}>
              {(harness) => <DesktopBypassItem harness={harness()} />}
            </Show>
          </Dropdown.Group>
          <Show when={props.items.length > 0}>
            <Dropdown.Separator class="my-1 border-t border-edge-divider" />
          </Show>
        </Show>
        <Dropdown.Group>
          <For each={props.items}>{(item) => <DesktopItem item={item} />}</For>
        </Dropdown.Group>
      </Dropdown.Content>
    </Dropdown>
  );
}

function DesktopBypassItem(props: { harness: RegisteredHarness }) {
  const bypass = createBypassControl(() => props.harness);
  return (
    <>
      <Dropdown.CheckboxItem
        checked={bypass.checked()}
        disabled={bypass.disabled()}
        onChange={bypass.change}
      >
        <span class="min-w-0 flex-1">
          {t('runtimeSharing.dontAskBeforeActing')}
        </span>
      </Dropdown.CheckboxItem>
      <div class="px-2 pt-1 pb-1.5">
        <OptionsHint harness={props.harness} />
      </div>
    </>
  );
}

function MobileSheet(props: MenuProps) {
  const [open, setOpen] = createSignal(false);
  const owner = getOwner();
  const choose = (item: ComputerMenuItem) => {
    setOpen(false);
    item.onSelect();
  };
  return (
    <MobileDrawer side="bottom" open={open()} onOpenChange={setOpen}>
      <MobileDrawer.Trigger
        as={Button}
        variant="ghost"
        size="icon-md"
        aria-label={t('computers.more', { name: props.name })}
      >
        <DotsThreeIcon class="size-4" />
      </MobileDrawer.Trigger>
      <MobileDrawer.Portal>
        <MobileDrawer.Overlay />
        <MobileDrawer.Content aria-label={props.name}>
          <MobileDrawer.Handle />
          <MobileDrawer.Title class="px-4 pb-3 text-base font-semibold break-words">
            {props.name}
          </MobileDrawer.Title>
          <MobileDrawer.ScrollBody>
            <div class="flex flex-col gap-1 px-2 pb-6">
              <Show when={props.share}>
                {(share) => <MobileItem item={share()} onChoose={choose} />}
              </Show>
              <Show when={props.harness}>
                {(harness) => (
                  <MobileBypassRow harness={harness()} owner={owner} />
                )}
              </Show>
              <For each={props.items}>
                {(item) => <MobileItem item={item} onChoose={choose} />}
              </For>
            </div>
          </MobileDrawer.ScrollBody>
        </MobileDrawer.Content>
      </MobileDrawer.Portal>
    </MobileDrawer>
  );
}

function MobileItem(props: {
  item: ComputerMenuItem;
  onChoose: (item: ComputerMenuItem) => void;
}) {
  return (
    <MobileDrawer.Item
      class={props.item.danger ? 'text-failure' : undefined}
      disabled={props.item.disabled}
      onClick={() => props.onChoose(props.item)}
    >
      <ItemIcon icon={props.item.icon} />
      {props.item.label}
    </MobileDrawer.Item>
  );
}

function MobileBypassRow(props: {
  harness: RegisteredHarness;
  owner: ReturnType<typeof getOwner>;
}) {
  // The confirmation stacks on this sheet, so it opens under the sheet's owner.
  const bypass = createBypassControl(() => props.harness, {
    owner: props.owner,
  });
  return (
    <div class="my-2 flex flex-col gap-2 border-y border-edge-divider px-3 py-4">
      <ToggleSwitch
        size="md"
        label={t('runtimeSharing.dontAskBeforeActing')}
        labelClass="text-sm text-ink"
        checked={bypass.checked()}
        disabled={bypass.disabled()}
        onChange={bypass.change}
      />
      <OptionsHint harness={props.harness} />
    </div>
  );
}

/**
 * Everything a computer row does besides its one primary action: a ⋯ menu on
 * desktop, a bottom sheet on touch. `harness` adds its Don't ask option.
 */
export function ComputerActionsMenu(props: MenuProps) {
  return (
    <Show when={props.items.length > 0 || props.share || props.harness}>
      <Show when={isTouchDevice()} fallback={<DesktopMenu {...props} />}>
        <MobileSheet {...props} />
      </Show>
    </Show>
  );
}
