import { t } from '@app/lib/i18n';
import type { CallPanelState } from '@channel/Call/discussion/CallDiscussionContent';
import { setNativeCallKitVideoOverlayMode } from '@channel/Call/use-callkit';
import { fireAndForget } from '@core/util/fireAndForget';
import Phone from '@icon/system/regular/phone-call.svg';
import PhoneDisconnect from '@icon/system/regular/phone-disconnect.svg';
import { Button } from '@ui';
import { type JSX, onMount } from 'solid-js';

/**
 * A meeting whose media runs on the native call screen, as channel calls do
 * in the iOS app. Opening the page shows that screen; behind it the page
 * keeps the meeting's chat, a way back to the call, and Leave.
 */
export function NativeMeetingCall(props: {
  onLeave: () => void;
  discussion: (panel: CallPanelState) => JSX.Element;
  /** Notices about the call, above its actions. */
  children?: JSX.Element;
}) {
  const openCall = () =>
    fireAndForget(setNativeCallKitVideoOverlayMode('expanded'), 'meetings');
  onMount(openCall);

  return (
    <div class="flex h-full min-h-0 flex-col gap-3 touch:pt-(--mobile-content-inset-top)">
      {props.children}
      <div class="flex gap-2 px-(--mobile-chrome-gutter)">
        <Button
          variant="ghost"
          size="lg"
          class="flex-1 bg-hover text-ink"
          onClick={openCall}
        >
          <Phone class="size-5" />
          {t('calls.openCall')}
        </Button>
        <Button
          variant="danger"
          size="lg"
          class="flex-1"
          onClick={props.onLeave}
        >
          <PhoneDisconnect class="size-5" />
          {t('calls.leave')}
        </Button>
      </div>
      <div class="flex min-h-0 flex-1 flex-col">
        {props.discussion({
          open: true,
          focusOnOpen: false,
          onClose: () => {},
        })}
      </div>
    </div>
  );
}
