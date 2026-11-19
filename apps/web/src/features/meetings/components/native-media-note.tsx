import { t } from '@app/lib/i18n';
import Microphone from '@icon/system/regular/microphone.svg';
import { type JSX, Show } from 'solid-js';

/** Waiting-room stand-in when the call's media runs on the native call screen. */
export function NativeMediaNote(props: { avatar?: JSX.Element }) {
  return (
    <section
      aria-label={t('calls.nativeMediaSetup')}
      class="flex min-w-0 flex-col items-center gap-4 rounded-2xl bg-panel p-8"
    >
      <Show when={props.avatar}>
        <div class="size-20 overflow-hidden rounded-full">{props.avatar}</div>
      </Show>
      <p class="flex max-w-sm items-start gap-2 text-left text-sm text-ink-muted">
        <Microphone class="mt-0.5 size-4 shrink-0" />
        {t('calls.nativeMediaNote')}
      </p>
    </section>
  );
}
