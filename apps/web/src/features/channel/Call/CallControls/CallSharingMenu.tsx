import { MobileDrawer } from '@components/app/mobile/MobileDrawer';
import { isMobile } from '@core/mobile/isMobile';
import Lock from '@icon/system/regular/lock-simple.svg';
import Users from '@icon/system/regular/users-three.svg';
import { Button, Dropdown, SingleSelectCheck } from '@ui';
import { createSignal, createUniqueId, For, type JSX, Show } from 'solid-js';
import { Dynamic } from 'solid-js/web';
import { CallSettingsMenu } from './CallSettingsMenu';

const sharingOptions = [
  {
    value: 'team',
    label: 'Team sharing',
    description: "Share with the creator's team after the call.",
    icon: Users,
  },
  {
    value: 'private',
    label: 'Private',
    description: 'No automatic team access.',
    icon: Lock,
  },
] as const;

type SharingOption = (typeof sharingOptions)[number];

function SharingOptionContent(props: {
  option: SharingOption;
  descriptionId: string;
  selected: boolean;
}) {
  return (
    <>
      <Dynamic
        component={props.option.icon}
        class="mt-0.5 size-4 shrink-0 self-start"
      />
      <div class="min-w-0 flex-1">
        <span class="block">{props.option.label}</span>
        <span id={props.descriptionId} class="block text-xs text-ink-muted">
          {props.option.description}
        </span>
      </div>
      <span class="mt-1 size-3 shrink-0 self-start" aria-hidden="true">
        <SingleSelectCheck active={props.selected} />
      </span>
    </>
  );
}

export function CallSharingMenu(props: {
  sharedWithTeam: boolean;
  disabled: boolean;
  /** A change is already awaiting approval, so the options wait for it too. */
  changePending: boolean;
  /** Where that change stands. */
  status: JSX.Element;
  onToggle: () => void;
  onOpenChange: (open: boolean) => void;
}) {
  const [open, setOpen] = createSignal(false);
  const id = createUniqueId();
  const selected = () => (props.sharedWithTeam ? 'team' : 'private');
  const label = () =>
    props.sharedWithTeam
      ? 'Call sharing: Team sharing'
      : 'Call sharing: Private';
  const setMenuOpen = (open: boolean) => {
    setOpen(open);
    props.onOpenChange(open);
  };
  const optionsDisabled = () => props.disabled || props.changePending;
  const select = (value: string) => {
    if (optionsDisabled()) return;
    if (value !== selected()) props.onToggle();
    setMenuOpen(false);
  };

  return (
    <CallSettingsMenu
      title="Call sharing"
      open={open()}
      onOpenChange={setMenuOpen}
      trigger={(triggerProps) => (
        <Button
          {...triggerProps}
          size={isMobile() ? 'icon-md' : 'icon-lg'}
          aria-label={label()}
          disabled={props.disabled}
          tooltip={{ content: label(), placement: 'top', disabled: open() }}
        >
          <Show when={props.sharedWithTeam} fallback={<Lock class="size-5" />}>
            <Users class="size-5" />
          </Show>
        </Button>
      )}
      mobileContent={
        <>
          {props.status}
          <MobileDrawer.Section role="radiogroup" aria-label="Call sharing">
            <For each={sharingOptions}>
              {(option) => (
                <MobileDrawer.Item
                  role="radio"
                  aria-label={option.label}
                  aria-describedby={`${id}-${option.value}`}
                  aria-checked={selected() === option.value}
                  disabled={optionsDisabled()}
                  onClick={() => select(option.value)}
                >
                  <SharingOptionContent
                    option={option}
                    descriptionId={`${id}-${option.value}`}
                    selected={selected() === option.value}
                  />
                </MobileDrawer.Item>
              )}
            </For>
          </MobileDrawer.Section>
        </>
      }
    >
      <Dropdown.Group>
        <Dropdown.GroupLabel>Call sharing</Dropdown.GroupLabel>
        {props.status}
        <Dropdown.RadioGroup value={selected()} onChange={select}>
          <For each={sharingOptions}>
            {(option) => (
              <Dropdown.RadioItem
                value={option.value}
                textValue={option.label}
                aria-label={option.label}
                aria-describedby={`${id}-${option.value}`}
                disabled={optionsDisabled()}
              >
                <SharingOptionContent
                  option={option}
                  descriptionId={`${id}-${option.value}`}
                  selected={selected() === option.value}
                />
              </Dropdown.RadioItem>
            )}
          </For>
        </Dropdown.RadioGroup>
      </Dropdown.Group>
    </CallSettingsMenu>
  );
}
