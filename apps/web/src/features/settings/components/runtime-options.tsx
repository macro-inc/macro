import { t } from '@app/lib/i18n';
import { MobileDrawer } from '@components/app/mobile/MobileDrawer';
import { toast } from '@core/component/Toast/Toast';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { fireAndForget } from '@core/util/fireAndForget';
import { usePatchHarnessMutation } from '@queries/harnesses/harnesses';
import type { Harness as RegisteredHarness } from '@service-storage/client';
import { Button, Dropdown, type OpenDialogOptions, ToggleSwitch } from '@ui';
import { createSignal, getOwner, Show } from 'solid-js';
import { confirmPermissionBypass } from '../confirm-permission-bypass';

/**
 * Turns "Don't ask before acting" (the runtime's permission bypass) on or off.
 * Turning it on asks first; only the owner may change it.
 */
export function createBypassControl(
  harness: () => RegisteredHarness,
  dialogOptions?: OpenDialogOptions
) {
  const patchHarness = usePatchHarnessMutation();
  const canChange = () => harness().access === 'owner';
  const set = async (allowed: boolean) => {
    if (allowed && !(await confirmPermissionBypass(undefined, dialogOptions)))
      return;
    try {
      await patchHarness.mutateAsync({
        harnessId: harness().id,
        allowPermissionBypass: allowed,
      });
    } catch {
      toast.failure(t('runtimeSharing.dontAskFailed'));
    }
  };
  return {
    checked: () => harness().allow_permission_bypass,
    disabled: () => !canChange() || patchHarness.isPending,
    canChange,
    change: (allowed: boolean) =>
      fireAndForget(set(allowed), 'harness-settings'),
  };
}

export function OptionsHint(props: { harness: RegisteredHarness }) {
  return (
    <p class="text-xs text-ink-extra-muted">
      {props.harness.access === 'owner'
        ? t('runtimeSharing.dontAskBeforeActingHint')
        : t('runtimeSharing.dontAskBeforeActingOwnerOnly')}
    </p>
  );
}

function DesktopRuntimeOptions(props: { harness: RegisteredHarness }) {
  const bypass = createBypassControl(() => props.harness);
  return (
    <Dropdown placement="bottom-end">
      <Dropdown.Trigger variant="secondary" size="sm">
        {t('runtimeSharing.options')}
      </Dropdown.Trigger>
      <Dropdown.Content class="min-w-64 max-w-80">
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
      </Dropdown.Content>
    </Dropdown>
  );
}

function MobileRuntimeOptions(props: { harness: RegisteredHarness }) {
  const [open, setOpen] = createSignal(false);
  // The confirmation stacks on this sheet, so it opens under the sheet's owner.
  const bypass = createBypassControl(() => props.harness, {
    owner: getOwner(),
  });
  return (
    <MobileDrawer side="bottom" open={open()} onOpenChange={setOpen}>
      <MobileDrawer.Trigger as={Button} variant="secondary" size="sm">
        {t('runtimeSharing.options')}
      </MobileDrawer.Trigger>
      <MobileDrawer.Portal>
        <MobileDrawer.Overlay />
        <MobileDrawer.Content
          aria-label={t('runtimeSharing.optionsTitle', {
            name: props.harness.name,
          })}
        >
          <MobileDrawer.Handle />
          <MobileDrawer.Title class="px-4 pb-3 text-base font-semibold break-words">
            {t('runtimeSharing.optionsTitle', { name: props.harness.name })}
          </MobileDrawer.Title>
          <MobileDrawer.ScrollBody>
            <div class="flex flex-col gap-2 px-4 pb-6">
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
          </MobileDrawer.ScrollBody>
        </MobileDrawer.Content>
      </MobileDrawer.Portal>
    </MobileDrawer>
  );
}

/** A runtime's Options: a menu on desktop, a sheet on touch. */
export function RuntimeOptions(props: { harness: RegisteredHarness }) {
  return (
    <Show
      when={isTouchDevice()}
      fallback={<DesktopRuntimeOptions harness={props.harness} />}
    >
      <MobileRuntimeOptions harness={props.harness} />
    </Show>
  );
}
