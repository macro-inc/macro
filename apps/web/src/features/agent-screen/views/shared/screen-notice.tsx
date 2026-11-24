import { t } from '@app/lib/i18n';
import InfoIcon from '@icon/system/regular/info.svg';
import { Show } from 'solid-js';
import { match } from 'ts-pattern';
import type { ScreenError } from '../../transports/types';

/** One line under the picture for an error the server sent on an open socket. */
export function ScreenNotice(props: { notice: ScreenError | undefined }) {
  const text = (notice: ScreenError) =>
    match(notice.code)
      .with('driverBusy', () => t('agentScreen.noticeDriverBusy'))
      .with('driveNotAllowed', 'notDriver', () =>
        t('agentScreen.noticeDriveNotAllowed')
      )
      .with('inputFailed', () => t('agentScreen.noticeInputFailed'))
      .with('sourceUnavailable', () => t('agentScreen.noticeSourceUnavailable'))
      .with('tunnelFailed', () => t('agentScreen.noticeTunnelFailed'))
      .with('tooManySockets', () => t('agentScreen.noticeTooManySockets'))
      .with('agentNotPausable', () => t('agentScreen.noticeAgentNotPausable'))
      .with('takeOverUnavailable', () =>
        t('agentScreen.noticeTakeOverUnavailable')
      )
      .with('unknown', () => t('agentScreen.noticeUnknown'))
      .with('pasteUnsupported', () => t('agentScreen.noticePasteUnsupported'))
      // A message the client sent wrong: nothing the person can do.
      // A stale hand-back released nothing; the fresh state says who drives.
      .with('badMessage', 'staleHandBack', () => undefined)
      .exhaustive();

  return (
    <Show when={props.notice && text(props.notice)}>
      {(message) => (
        <p class="flex items-center gap-1.5 text-xs text-ink-muted">
          <InfoIcon class="size-3.5 shrink-0" />
          {message()}
        </p>
      )}
    </Show>
  );
}
