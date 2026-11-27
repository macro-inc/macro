import { t } from '@app/lib/i18n';
import { MobileDrawer } from '@components/app/mobile/MobileDrawer';
import CheckIcon from '@icon/system/regular/check.svg';
import DotsThreeIcon from '@icon/system/regular/dots-three.svg';
import TrashIcon from '@icon/system/regular/trash.svg';
import WaveformIcon from '@icon/system/regular/waveform.svg';
import { Button, ToggleSwitch } from '@ui';
import { createSignal, For, type JSX, Show } from 'solid-js';
import {
  ASSIGNABLE_ROLES,
  crmAccessFixed,
  removalLockReason,
  roleLockReason,
  roleName,
  seatPlanName,
  seatPlanOptions,
  type TeamAgentMenuProps,
  type TeamMemberMenuProps,
} from '../shared/team-member-menu';

/** The ⋯ and the sheet it opens, titled with whose settings they are. */
function Sheet(props: {
  name: string;
  email?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: JSX.Element;
}) {
  return (
    <MobileDrawer
      side="bottom"
      open={props.open}
      onOpenChange={props.onOpenChange}
    >
      <MobileDrawer.Trigger
        as={Button}
        variant="ghost"
        size="icon-md"
        class="size-11 shrink-0"
        aria-label={t('teamMembers.settingsFor', { name: props.name })}
      >
        <DotsThreeIcon class="size-4" />
      </MobileDrawer.Trigger>
      <MobileDrawer.Portal>
        <MobileDrawer.Overlay />
        <MobileDrawer.Content aria-label={props.name}>
          <MobileDrawer.Handle />
          <div class="px-4 pb-3">
            <MobileDrawer.Title class="text-base font-semibold break-words text-ink">
              {props.name}
            </MobileDrawer.Title>
            <Show when={props.email}>
              <MobileDrawer.Description class="text-xs break-words text-ink-muted">
                {props.email}
              </MobileDrawer.Description>
            </Show>
          </div>
          <MobileDrawer.ScrollBody>
            <div class="flex flex-col gap-4 pb-6">{props.children}</div>
          </MobileDrawer.ScrollBody>
        </MobileDrawer.Content>
      </MobileDrawer.Portal>
    </MobileDrawer>
  );
}

/**
 * One choice in a section, checked like the phone filter options. A choice
 * the viewer can't change stays readable, with why under it, as the
 * dropdown's unavailable items do on touch.
 */
function Choice(props: {
  label: string;
  description?: string;
  lockedReason?: string;
  checked: boolean;
  disabled?: boolean;
  onSelect: () => void;
}) {
  return (
    <MobileDrawer.Item
      role="radio"
      aria-checked={props.checked}
      aria-disabled={props.lockedReason ? true : undefined}
      disabled={props.disabled}
      onClick={() => {
        if (!props.lockedReason) props.onSelect();
      }}
    >
      <span class="flex min-w-0 flex-1 flex-col">
        <span classList={{ 'text-ink-muted': !!props.lockedReason }}>
          {props.label}
        </span>
        <Show when={props.description}>
          <span class="text-xs text-ink-muted">{props.description}</span>
        </Show>
        <Show when={props.lockedReason}>
          <span class="text-xs text-ink-muted">{props.lockedReason}</span>
        </Show>
      </span>
      <span class="flex size-5 shrink-0 items-center justify-center">
        <Show when={props.checked}>
          <CheckIcon class="size-4 text-ink" />
        </Show>
      </span>
    </MobileDrawer.Item>
  );
}

/** A labelled group of choices, with anything that acts on them after. */
function Choices(props: {
  label: string;
  children: JSX.Element;
  after?: JSX.Element;
}) {
  return (
    <div>
      <MobileDrawer.Label>{props.label}</MobileDrawer.Label>
      <MobileDrawer.Section>
        <div role="radiogroup" aria-label={props.label}>
          {props.children}
        </div>
        {props.after}
      </MobileDrawer.Section>
    </div>
  );
}

/**
 * A person's seat plan, role, CRM access and Remove in a sheet. Choosing a
 * plan or role, or Remove, closes it; the CRM switch changes in place.
 */
export function TeamMemberMenu(props: TeamMemberMenuProps) {
  const [open, setOpen] = createSignal(false);
  const choose = (change: () => void) => {
    setOpen(false);
    change();
  };

  return (
    <Sheet
      name={props.name}
      email={props.email}
      open={open()}
      onOpenChange={setOpen}
    >
      <Show when={props.plan}>
        {(plan) => (
          <Choices
            label={t('teamMembers.plan')}
            after={
              <Show when={props.pendingDowngrade}>
                <MobileDrawer.Item
                  disabled={props.planPending}
                  onClick={() => choose(() => props.onPlanChange(plan()))}
                >
                  {t('teamMembers.keepPlan', { plan: seatPlanName(plan()) })}
                </MobileDrawer.Item>
              </Show>
            }
          >
            <For each={seatPlanOptions(props.annual)}>
              {(option) => (
                <Choice
                  label={option.label}
                  description={option.description}
                  checked={option.value === plan()}
                  disabled={props.planPending}
                  onSelect={() => {
                    if (option.value === plan()) return;
                    choose(() => props.onPlanChange(option.value));
                  }}
                />
              )}
            </For>
          </Choices>
        )}
      </Show>
      <Choices label={t('teamMembers.role')}>
        <Show
          when={!props.roleLock}
          fallback={
            <Choice
              label={roleName(props.role)}
              lockedReason={props.roleLock && roleLockReason(props.roleLock)}
              checked
              onSelect={() => {}}
            />
          }
        >
          <For each={ASSIGNABLE_ROLES}>
            {(role) => (
              <Choice
                label={roleName(role)}
                checked={props.role === role}
                onSelect={() => {
                  if (props.role === role) return;
                  choose(() => props.onRoleChange(role));
                }}
              />
            )}
          </For>
        </Show>
      </Choices>
      <Show when={props.manageCrm}>
        <MobileDrawer.Section class="flex flex-col gap-1 px-3 py-2.5">
          <ToggleSwitch
            size="md"
            label={
              <>
                <span aria-hidden="true">{t('crm.memberAccess')}</span>
                <span class="sr-only">
                  {t('crm.memberAccessFor', { name: props.name })}
                </span>
              </>
            }
            labelClass="text-sm text-ink"
            class="min-h-11"
            checked={props.crmAccess}
            disabled={crmAccessFixed(props.role) || props.crmPending}
            onChange={props.onCrmAccessChange}
          />
          <Show when={crmAccessFixed(props.role)}>
            <p class="text-xs text-ink-muted">{t('crm.memberAccessAlways')}</p>
          </Show>
        </MobileDrawer.Section>
      </Show>
      <MobileDrawer.Section>
        <MobileDrawer.Item
          class={props.removalLock ? 'text-ink-muted' : 'text-failure'}
          aria-disabled={props.removalLock ? true : undefined}
          onClick={() => {
            if (!props.removalLock) choose(props.onRemove);
          }}
        >
          <TrashIcon class="size-4 shrink-0" />
          <span class="flex min-w-0 flex-1 flex-col">
            <span>{t('teamMembers.remove')}</span>
            <Show when={props.removalLock}>
              {(lock) => (
                <span class="text-xs text-ink-muted">
                  {removalLockReason(lock())}
                </span>
              )}
            </Show>
          </span>
        </MobileDrawer.Item>
      </MobileDrawer.Section>
    </Sheet>
  );
}

/** An agent teammate's Change voice and Remove in a sheet. */
export function TeamAgentMenu(props: TeamAgentMenuProps) {
  const [open, setOpen] = createSignal(false);
  const choose = (action: () => void) => {
    setOpen(false);
    action();
  };

  return (
    <Show when={props.onChangeVoice || props.onRemove}>
      <Sheet name={props.name} open={open()} onOpenChange={setOpen}>
        <MobileDrawer.Section>
          <Show when={props.onChangeVoice}>
            {(changeVoice) => (
              <MobileDrawer.Item onClick={() => choose(changeVoice())}>
                <WaveformIcon class="size-4 shrink-0" />
                {t('teamAgents.changeVoice')}
              </MobileDrawer.Item>
            )}
          </Show>
          <Show when={props.onRemove}>
            {(remove) => (
              <MobileDrawer.Item
                class="text-failure"
                onClick={() => choose(remove())}
              >
                <TrashIcon class="size-4 shrink-0" />
                {t('teamAgents.remove')}
              </MobileDrawer.Item>
            )}
          </Show>
        </MobileDrawer.Section>
      </Sheet>
    </Show>
  );
}
