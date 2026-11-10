import { IS_MAC } from '@core/constant/isMac';
import { registerHotkey } from '@core/hotkey/hotkeys';
import { isMobile } from '@core/mobile/isMobile';
import { fireAndForget } from '@core/util/fireAndForget';
import { type Accessor, createEffect, on, onCleanup } from 'solid-js';
import type { CallState } from './CallContext';

export function canHoldToTalk(event?: KeyboardEvent) {
  if (!event || event.isComposing || event.repeat) return false;
  const target = event.target;
  return !(
    target instanceof Element &&
    target.closest(
      'input, textarea, select, button, a[href], [role="button"], [role="textbox"], [role^="menuitem"], [contenteditable]:not([contenteditable="false"])'
    )
  );
}

/** Register only while the call view owns these shortcuts; leave the app sheet unchanged. */
export function createCallHotkeys(
  call: Pick<
    CallState,
    | 'isInCall'
    | 'isConnecting'
    | 'activeCallId'
    | 'room'
    | 'isAudioMuted'
    | 'toggleAudio'
    | 'toggleVideo'
  >,
  fullscreen: { available: Accessor<boolean>; toggle: () => Promise<void> }
) {
  let hold:
    | { id: string; room: ReturnType<CallState['room']>; ready: Promise<void> }
    | undefined;
  let restoring = false;
  const release = () => {
    const current = hold;
    hold = undefined;
    if (!current) return;
    restoring = true;
    // The press promise already reports its error; still restore after a failed press.
    fireAndForget(
      current.ready
        .catch(() => {})
        .then(async () => {
          if (
            call.isInCall() &&
            call.activeCallId() === current.id &&
            call.room() === current.room &&
            !call.isAudioMuted()
          ) {
            await call.toggleAudio();
          }
        })
        .finally(() => {
          restoring = false;
        }),
      'call.push-to-talk.release'
    );
  };
  createEffect(
    on(
      () => isMobile() || !call.isInCall(),
      (disabled) => {
        if (disabled) return;
        const common = {
          scopeId: 'global',
          hide: true,
          registrationType: 'add' as const,
          condition: () => call.isInCall() && !call.isConnecting(),
        };
        registerHotkey({
          ...common,
          hotkey: 'cmd+d',
          description: 'Mute or unmute',
          runWithInputFocused: true,
          keyDownHandler: (event) => {
            if (event?.repeat || restoring) return true;
            if (hold) release();
            else fireAndForget(call.toggleAudio(), 'call.shortcut.microphone');
            return true;
          },
        });
        registerHotkey({
          ...common,
          hotkey: 'shift+cmd+e',
          description: 'Turn camera on or off',
          runWithInputFocused: true,
          keyDownHandler: (event) => {
            if (!event?.repeat)
              fireAndForget(call.toggleVideo(), 'call.shortcut.camera');
            return true;
          },
        });
        registerHotkey({
          ...common,
          hotkey: IS_MAC ? 'ctrl+cmd+f' : 'f11',
          description: 'Enter or leave full screen',
          runWithInputFocused: true,
          keyDownHandler: (event) => {
            if (!fullscreen.available()) return false;
            if (!event?.repeat)
              fireAndForget(fullscreen.toggle(), 'call.shortcut.fullscreen');
            return true;
          },
        });
        registerHotkey({
          ...common,
          hotkey: 'space',
          description: 'Hold to talk while muted',
          keyDownHandler: (event) => {
            if (event?.repeat) return !!hold;
            if (!canHoldToTalk(event)) return false;
            if (hold || restoring) return true;
            const id = call.activeCallId();
            if (!id || !call.isAudioMuted()) return false;
            const room = call.room();
            const ready = call.toggleAudio();
            hold = { id, room, ready };
            fireAndForget(ready, 'call.push-to-talk.press');
            return true;
          },
          keyUpHandler: release,
        });
        window.addEventListener('blur', release);
        const onVisibility = () => {
          if (document.hidden) release();
        };
        document.addEventListener('visibilitychange', onVisibility);
        onCleanup(() => {
          release();
          window.removeEventListener('blur', release);
          document.removeEventListener('visibilitychange', onVisibility);
        });
      }
    )
  );
}
