import { t } from '@app/lib/i18n';
import { MobileDrawer } from '@components/app/mobile/MobileDrawer';
import CaretUp from '@icon/system/regular/caret-up.svg';
import Hash from '@icon/system/regular/hash.svg';
import Lock from '@icon/system/regular/lock-simple.svg';
import Users from '@icon/system/regular/users-three.svg';
import { Button, Dropdown, SingleSelectCheck } from '@ui';
import {
  type Component,
  createSignal,
  createUniqueId,
  For,
  type JSX,
  Show,
} from 'solid-js';
import { Dynamic } from 'solid-js/web';
import { CallSettingsMenu } from './CallSettingsMenu';

type SharingOption = {
  value: 'team' | 'private';
  label: string;
  description: string;
  icon: Component<JSX.SvgSVGAttributes<SVGSVGElement>>;
};

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
  onToggle: () => void;
  onOpenChange: (open: boolean) => void;
  /** Present only when the discussion is authorized through this channel. */
  channelName?: string;
  compact?: boolean;
  size?: 'md' | 'lg';
}) {
  const [open, setOpen] = createSignal(false);
  const id = createUniqueId();
  const selected = () => (props.sharedWithTeam ? 'team' : 'private');
  const options = (): SharingOption[] => [
    {
      value: 'team',
      label: t('calls.shareWithTeam'),
      description: t('calls.creatorTeamDescription'),
      icon: Users,
    },
    {
      value: 'private',
      label: props.channelName ? t('calls.channelOnly') : t('calls.private'),
      description: props.channelName
        ? t('calls.channelOnlyDescription', { channel: props.channelName })
        : t('calls.privateDescription'),
      icon: props.channelName ? Hash : Lock,
    },
  ];
  const label = () =>
    props.sharedWithTeam
      ? t('calls.team')
      : props.channelName
        ? t('calls.channel')
        : t('calls.private');
  const setMenuOpen = (open: boolean) => {
    setOpen(open);
    props.onOpenChange(open);
  };
  const select = (value: string) => {
    if (props.disabled) return;
    if (value !== selected()) props.onToggle();
    setMenuOpen(false);
  };

  return (
    <CallSettingsMenu
      title={t('calls.afterCallEnds')}
      open={open()}
      onOpenChange={setMenuOpen}
      trigger={(triggerProps) => (
        <Button
          {...triggerProps}
          size={props.size ?? (props.compact ? 'md' : 'lg')}
          variant="secondary"
          aria-label={t('calls.sharingLabel', { mode: label() })}
          disabled={props.disabled}
          tooltip={{
            content: t('calls.sharingLabel', { mode: label() }),
            placement: 'top',
            disabled: open(),
          }}
        >
          <Dynamic
            component={
              props.sharedWithTeam ? Users : props.channelName ? Hash : Lock
            }
            class="size-4"
          />
          <Show when={!props.compact}>
            <span class="not-mobile:@max-[36rem]/call-stage:hidden">
              {label()}
            </span>
          </Show>
          <Show when={!props.compact}>
            <CaretUp class="size-3" />
          </Show>
        </Button>
      )}
      mobileContent={
        <MobileDrawer.Section
          role="radiogroup"
          aria-label={t('calls.afterCallEnds')}
        >
          <For each={options()}>
            {(option) => (
              <MobileDrawer.Item
                role="radio"
                aria-label={option.label}
                aria-describedby={`${id}-${option.value}`}
                aria-checked={selected() === option.value}
                disabled={props.disabled}
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
      }
    >
      <Dropdown.Group>
        <Dropdown.GroupLabel>{t('calls.afterCallEnds')}</Dropdown.GroupLabel>
        <Dropdown.RadioGroup value={selected()} onChange={select}>
          <For each={options()}>
            {(option) => (
              <Dropdown.RadioItem
                value={option.value}
                textValue={option.label}
                aria-label={option.label}
                aria-describedby={`${id}-${option.value}`}
                disabled={props.disabled}
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
