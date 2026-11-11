import { t } from '@app/lib/i18n';
import { toast } from '@core/component/Toast/Toast';
import { fireAndForget } from '@core/util/fireAndForget';
import { getPlatform } from '@core/util/platform';
import { catchToResult } from '@core/util/result';
import MicrophoneSlash from '@icon/system/regular/microphone-slash.svg';
import { Telemetry } from '@macro-inc/observability';
import { invoke } from '@tauri-apps/api/core';
import { match } from 'ts-pattern';

type MicrophoneBlockedSource = 'join' | 'unmute';

async function openMicrophoneSettings(): Promise<void> {
  await Telemetry.span('call.microphone_access.open_settings', async (span) => {
    const result = await catchToResult(() =>
      invoke('plugin:call-kit|open_microphone_settings')
    );
    span.setAttr(
      'call.microphone_access.outcome',
      result.isOk() ? 'opened' : 'failed'
    );
    // Android builds before this command can't open Settings; the text
    // still says where to go.
    if (result.isErr())
      console.error('[call] failed to open microphone settings', result.error);
  });
}

let visibleToastId: number | undefined;

/**
 * Once a phone has denied the microphone it never asks again, so a call
 * that can't use it has to say where to turn it back on.
 */
export function showMicrophoneBlockedToast(source: MicrophoneBlockedSource) {
  const platform = getPlatform();
  Telemetry.warn('Call microphone access is blocked', {
    'call.microphone_access.source': source,
    'call.microphone_access.platform': platform,
  });
  if (visibleToastId !== undefined) toast.dismiss(visibleToastId);

  const nativeMobile = platform === 'ios' || platform === 'android';
  const toastId = toast.custom(
    {
      title: t('calls.microphoneAccessTitle'),
      icon: MicrophoneSlash,
      color: 'var(--color-failure)',
      titleColor: 'var(--color-failure)',
      dismissLabel: t('common.maybeLater'),
      content: () => (
        <div class="text-xs text-ink-extra-muted">
          {match(platform)
            .with('ios', 'android', () => t('calls.microphoneAccessMobile'))
            .with('desktop', () => t('calls.microphoneAccessDesktop'))
            .with('web', () => t('calls.microphoneAccessBrowser'))
            .exhaustive()}
        </div>
      ),
      actions: nativeMobile
        ? [
            {
              label: t('calls.openSettings'),
              onClick: () =>
                fireAndForget(openMicrophoneSettings(), 'channel-call'),
            },
          ]
        : undefined,
    },
    {
      duration: 10_000,
      onDismiss: () => {
        if (visibleToastId === toastId) visibleToastId = undefined;
      },
    }
  );
  visibleToastId = toastId;
}
