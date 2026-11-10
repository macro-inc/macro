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

function DesktopMenu(props: {
  name: string;
  items: readonly ComputerMenuItem[];
  harness?: RegisteredHarness;
}) {
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
        <Dropdown.Group>
          <For each={props.items}>
            {(item) => (
              <Dropdown.Item
                class={
                  item.danger
                    ? 'text-failure data-highlighted:bg-failure-bg'
                    : undefined
                }
                disabled={item.disabled}
                onSelect={item.onSelect}
              >
                <ItemIcon icon={item.icon} />
                {item.label}
              </Dropdown.Item>
            )}
          </For>
        </Dropdown.Group>
        <Show when={props.harness}>
          {(harness) => <DesktopBypassItem harness={harness()} />}
        </Show>
      </Dropdown.Content>
    </Dropdown>
  );
}

function DesktopBypassItem(props: { harness: RegisteredHarness }) {
  const bypass = createBypassControl(() => props.harness);
  return (
    <>
      <Dropdown.Separator class="my-1 border-t border-edge-divider" />
      <Dropdown.Group>
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
      </Dropdown.Group>
    </>
  );
}

function MobileSheet(props: {
  name: string;
  items: readonly ComputerMenuItem[];
  harness?: RegisteredHarness;
}) {
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
              <For each={props.items}>
                {(item) => (
                  <MobileDrawer.Item
                    class={item.danger ? 'text-failure' : undefined}
                    disabled={item.disabled}
                    onClick={() => choose(item)}
                  >
                    <ItemIcon icon={item.icon} />
                    {item.label}
                  </MobileDrawer.Item>
                )}
              </For>
              <Show when={props.harness}>
                {(harness) => (
                  <MobileBypassRow harness={harness()} owner={owner} />
                )}
              </Show>
            </div>
          </MobileDrawer.ScrollBody>
        </MobileDrawer.Content>
      </MobileDrawer.Portal>
    </MobileDrawer>
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
    <div class="mt-2 flex flex-col gap-2 border-t border-edge-divider px-3 pt-4">
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
export function ComputerActionsMenu(props: {
  name: string;
  items: readonly ComputerMenuItem[];
  harness?: RegisteredHarness;
}) {
  return (
    <Show when={props.items.length > 0 || props.harness}>
      <Show when={isTouchDevice()} fallback={<DesktopMenu {...props} />}>
        <MobileSheet {...props} />
      </Show>
    </Show>
  );
}
