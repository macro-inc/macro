import { t } from '@app/lib/i18n';
import CheckIcon from '@icon/system/regular/check.svg';
import DotsThreeIcon from '@icon/system/regular/dots-three.svg';
import TrashIcon from '@icon/system/regular/trash.svg';
import WaveformIcon from '@icon/system/regular/waveform.svg';
import { Dropdown } from '@ui';
import { For, type JSX, Show } from 'solid-js';
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
} from './shared/team-member-menu';

function MenuTrigger(props: { name: string }) {
  return (
    <Dropdown.Trigger
      variant="ghost"
      size="icon-md"
      class="shrink-0"
      aria-label={t('teamMembers.settingsFor', { name: props.name })}
    >
      <DotsThreeIcon class="size-4" />
    </Dropdown.Trigger>
  );
}

function Divider() {
  return <Dropdown.Separator class="my-1 border-t border-edge-divider" />;
}

/**
 * An item's label, with why it can't be chosen under it. The reason is
 * written out rather than in a tooltip: a disabled item never takes focus.
 */
function Reason(props: { label: string; reason?: string }) {
  return (
    <span class="flex min-w-0 flex-1 flex-col">
      <span>{props.label}</span>
      <Show when={props.reason}>
        <span class="text-xs text-ink-muted">{props.reason}</span>
      </Show>
    </span>
  );
}

function Choice(props: {
  value: string;
  label: string;
  description?: string;
  disabled?: boolean;
}) {
  return (
    <Dropdown.RadioItem
      value={props.value}
      disabled={props.disabled}
      closeOnSelect
    >
      <span class="flex min-w-0 flex-1 flex-col">
        <span>{props.label}</span>
        <Show when={props.description}>
          <span class="text-xs text-ink-muted">{props.description}</span>
        </Show>
      </span>
      <Dropdown.ItemIndicator>
        <CheckIcon class="size-3.5 text-ink" />
      </Dropdown.ItemIndicator>
    </Dropdown.RadioItem>
  );
}

/** A person's seat plan, role, CRM access and Remove, behind their ⋯. */
export function TeamMemberMenu(props: TeamMemberMenuProps) {
  const choosePlan = (value: string) => {
    const option = seatPlanOptions(props.annual).find(
      (plan) => plan.value === value
    );
    if (option && option.value !== props.plan) props.onPlanChange(option.value);
  };
  const chooseRole = (value: string) => {
    const role = ASSIGNABLE_ROLES.find((choice) => choice === value);
    if (role && role !== props.role) props.onRoleChange(role);
  };

  return (
    <Dropdown placement="bottom-end">
      <MenuTrigger name={props.name} />
      <Dropdown.Content class="min-w-60 max-w-80">
        <Show when={props.plan}>
          {(plan) => (
            <>
              <Dropdown.Group>
                <Dropdown.GroupLabel>
                  {t('teamMembers.plan')}
                </Dropdown.GroupLabel>
                <Dropdown.RadioGroup value={plan()} onChange={choosePlan}>
                  <For each={seatPlanOptions(props.annual)}>
                    {(option) => (
                      <Choice
                        value={option.value}
                        label={option.label}
                        description={option.description}
                        disabled={props.planPending}
                      />
                    )}
                  </For>
                </Dropdown.RadioGroup>
                <Show when={props.pendingDowngrade}>
                  <Dropdown.Item
                    disabled={props.planPending}
                    onSelect={() => props.onPlanChange(plan())}
                  >
                    {t('teamMembers.keepPlan', {
                      plan: seatPlanName(plan()),
                    })}
                  </Dropdown.Item>
                </Show>
              </Dropdown.Group>
              <Divider />
            </>
          )}
        </Show>
        <Dropdown.Group>
          <Dropdown.GroupLabel>{t('teamMembers.role')}</Dropdown.GroupLabel>
          <Show
            when={!props.roleLock}
            fallback={
              <Dropdown.Item disabled>
                <Reason
                  label={roleName(props.role)}
                  reason={props.roleLock && roleLockReason(props.roleLock)}
                />
                <CheckIcon class="size-3.5 text-ink" />
              </Dropdown.Item>
            }
          >
            <Dropdown.RadioGroup value={props.role} onChange={chooseRole}>
              <For each={ASSIGNABLE_ROLES}>
                {(role) => <Choice value={role} label={roleName(role)} />}
              </For>
            </Dropdown.RadioGroup>
          </Show>
        </Dropdown.Group>
        <Show when={props.manageCrm}>
          <Divider />
          <Dropdown.Group>
            <Dropdown.CheckboxItem
              checked={props.crmAccess}
              disabled={crmAccessFixed(props.role) || props.crmPending}
              closeOnSelect={false}
              onChange={props.onCrmAccessChange}
            >
              <span class="flex min-w-0 flex-1 flex-col">
                <span>
                  <span aria-hidden="true">{t('crm.memberAccess')}</span>
                  <span class="sr-only">
                    {t('crm.memberAccessFor', { name: props.name })}
                  </span>
                </span>
                <Show when={crmAccessFixed(props.role)}>
                  <span class="text-xs text-ink-muted">
                    {t('crm.memberAccessAlways')}
                  </span>
                </Show>
              </span>
            </Dropdown.CheckboxItem>
          </Dropdown.Group>
        </Show>
        <Divider />
        <Dropdown.Group>
          <Dropdown.Item
            class="text-failure data-highlighted:bg-failure-bg"
            disabled={!!props.removalLock}
            onSelect={props.onRemove}
          >
            <TrashIcon class="size-4" />
            <Reason
              label={t('teamMembers.remove')}
              reason={props.removalLock && removalLockReason(props.removalLock)}
            />
          </Dropdown.Item>
        </Dropdown.Group>
      </Dropdown.Content>
    </Dropdown>
  );
}

/** An agent teammate's Change voice and Remove, behind its ⋯. */
export function TeamAgentMenu(props: TeamAgentMenuProps): JSX.Element {
  return (
    <Show when={props.onChangeVoice || props.onRemove}>
      <Dropdown placement="bottom-end">
        <MenuTrigger name={props.name} />
        <Dropdown.Content class="min-w-48 max-w-80">
          <Show when={props.onChangeVoice}>
            {(changeVoice) => (
              <Dropdown.Group>
                <Dropdown.Item onSelect={() => changeVoice()()}>
                  <WaveformIcon class="size-4" />
                  {t('teamAgents.changeVoice')}
                </Dropdown.Item>
              </Dropdown.Group>
            )}
          </Show>
          <Show when={props.onRemove}>
            {(remove) => (
              <>
                <Show when={props.onChangeVoice}>
                  <Divider />
                </Show>
                <Dropdown.Group>
                  <Dropdown.Item
                    class="text-failure data-highlighted:bg-failure-bg"
                    onSelect={() => remove()()}
                  >
                    <TrashIcon class="size-4" />
                    {t('teamAgents.remove')}
                  </Dropdown.Item>
                </Dropdown.Group>
              </>
            )}
          </Show>
        </Dropdown.Content>
      </Dropdown>
    </Show>
  );
}
