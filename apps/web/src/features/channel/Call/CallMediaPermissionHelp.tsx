import { t } from '@app/lib/i18n';
import { IS_MAC } from '@core/constant/isMac';
import { fireAndForget } from '@core/util/fireAndForget';
import { isDesktopPlatform } from '@core/util/platform';
import { openExternalUrl } from '@core/util/url';
import { Popover } from '@kobalte/core/popover';
import { Button } from '@ui';
import { createEffect, createSignal, onCleanup, Show } from 'solid-js';
import type { CallMediaDevice } from './call-media-permissions';

type Media = {
  microphonePermission?: () => PermissionState;
  cameraPermission?: () => PermissionState;
  toggleAudio: (enabled?: boolean) => Promise<void>;
  toggleVideo: (enabled?: boolean) => Promise<void>;
};

export function createCallMediaPermissionHelp(media: Media) {
  const [help, setHelp] = createSignal<{
    device: CallMediaDevice;
    anchor?: HTMLElement;
  }>();
  const [pending, setPending] = createSignal({
    microphone: false,
    camera: false,
  });
  let revision = 0;
  let disposed = false;
  onCleanup(() => {
    disposed = true;
    revision++;
  });
  const permission = (device: CallMediaDevice) =>
    device === 'microphone'
      ? media.microphonePermission?.()
      : media.cameraPermission?.();
  createEffect(() => {
    const current = help();
    if (current && permission(current.device) === 'granted') setHelp(undefined);
  });
  const close = () => {
    revision++;
    setHelp(undefined);
  };
  const request = async (device: CallMediaDevice, retry = false) => {
    if (pending()[device] || disposed) return;
    const current = ++revision;
    const anchor =
      help()?.anchor ??
      (document.activeElement instanceof HTMLElement
        ? document.activeElement
        : undefined);
    const blocked = permission(device) === 'denied';
    if (blocked) setHelp({ device, anchor });
    setPending((previous) => ({ ...previous, [device]: true }));
    try {
      const enable = retry || blocked ? true : undefined;
      if (device === 'microphone') await media.toggleAudio(enable);
      else await media.toggleVideo(enable);
      if (!disposed && current === revision) setHelp(undefined);
    } catch (error) {
      if (
        permission(device) !== 'denied' &&
        !(error instanceof DOMException && error.name === 'NotAllowedError')
      )
        throw error;
      if (!disposed && current === revision) setHelp({ device, anchor });
    } finally {
      if (!disposed)
        setPending((previous) => ({ ...previous, [device]: false }));
    }
  };
  return {
    help,
    pending: () => {
      const current = help();
      return !!current && pending()[current.device];
    },
    request,
    close,
  };
}

function permissionInstructions() {
  if (isDesktopPlatform()) return t('calls.permissionHelpNative');
  const agent = navigator.userAgent;
  if (/Firefox\//.test(agent)) return t('calls.permissionHelpFirefox');
  if (/Edg\//.test(agent)) return t('calls.permissionHelpEdge');
  if (/Chrome\//.test(agent)) return t('calls.permissionHelpChrome');
  if (/Safari\//.test(agent)) return t('calls.permissionHelpSafari');
  return t('calls.permissionHelpOther');
}

export function CallMediaPermissionHelp(props: {
  controller: ReturnType<typeof createCallMediaPermissionHelp>;
}) {
  const control = props.controller;
  const title = () =>
    control.help()?.device === 'camera'
      ? t('calls.enableCamera')
      : t('calls.enableMicrophone');
  return (
    <Popover
      open={!!control.help()}
      onOpenChange={(open) => {
        if (!open) control.close();
      }}
      placement="top"
      gutter={8}
      getAnchorRect={() => control.help()?.anchor?.getBoundingClientRect()}
    >
      <Popover.Portal
        mount={
          control.help()?.anchor?.closest<HTMLElement>('.portal-scope') ??
          undefined
        }
      >
        <Popover.Content class="menu-surface z-modal w-72 max-w-[calc(100vw-2rem)] rounded-xl p-4 outline-none">
          <Popover.Title class="text-sm font-semibold">{title()}</Popover.Title>
          <Popover.Description class="mt-2 text-sm text-ink-muted">
            {permissionInstructions()}
          </Popover.Description>
          <div class="mt-3 flex flex-wrap gap-2">
            <Show when={isDesktopPlatform() && IS_MAC}>
              <Button
                size="sm"
                variant="secondary"
                onClick={() =>
                  openExternalUrl(
                    `x-apple.systempreferences:com.apple.preference.security?Privacy_${control.help()?.device === 'camera' ? 'Camera' : 'Microphone'}`
                  )
                }
              >
                {t('calls.openSystemSettings')}
              </Button>
            </Show>
            <Button
              size="sm"
              variant="primary"
              disabled={control.pending()}
              onClick={() => {
                const current = control.help();
                if (current)
                  fireAndForget(
                    control.request(current.device, true),
                    'call-media-permission'
                  );
              }}
            >
              {t('calls.tryAgain')}
            </Button>
            <Popover.CloseButton as={Button} size="sm" variant="ghost">
              {t('calls.cancelPermissionHelp')}
            </Popover.CloseButton>
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover>
  );
}
