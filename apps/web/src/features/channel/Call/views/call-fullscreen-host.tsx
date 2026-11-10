import { t } from '@app/lib/i18n';
import { fireAndForget } from '@core/util/fireAndForget';
import { Button } from '@ui';
import {
  createContext,
  createEffect,
  createSignal,
  on,
  type ParentProps,
  Show,
  useContext,
} from 'solid-js';
import { Portal } from 'solid-js/web';
import { createCallFullscreen } from '../primitives/call-fullscreen';

const CallFullscreenContext = createContext<{
  host: () => HTMLDivElement | undefined;
  fullscreen: ReturnType<typeof createCallFullscreen>;
}>();

/** A persistent target preserves browser activation while the call route opens. */
export function CallFullscreenProvider(
  props: ParentProps<{ callId: () => string | null }>
) {
  const [host, setHost] = createSignal<HTMLDivElement>();
  const [entering, setEntering] = createSignal(false);
  const fullscreen = createCallFullscreen(host);
  createEffect(
    on(
      props.callId,
      () => fireAndForget(fullscreen.exit(), 'call-fullscreen'),
      { defer: true }
    )
  );
  const controller = {
    ...fullscreen,
    enter: async () => {
      setEntering(true);
      try {
        await fullscreen.enter();
      } finally {
        setEntering(false);
      }
    },
    toggle: async () => {
      if (fullscreen.active()) await fullscreen.exit();
      else await controller.enter();
    },
  };
  return (
    <CallFullscreenContext.Provider value={{ host, fullscreen: controller }}>
      {props.children}
      <div
        ref={setHost}
        hidden={!entering() && !fullscreen.active()}
        class="fixed inset-0 z-modal h-dvh w-screen bg-page text-ink"
      >
        <div class="absolute inset-0 grid place-content-center gap-3">
          <span>{t('nav.returnToCall')}</span>
          <Button
            onClick={() => fireAndForget(fullscreen.exit(), 'call-fullscreen')}
          >
            {t('calls.exitFullscreen')}
          </Button>
        </div>
      </div>
    </CallFullscreenContext.Provider>
  );
}

export const useCallFullscreenOptional = () =>
  useContext(CallFullscreenContext);

/** Moving the same content nodes preserves tracks, editor state and component owners. */
export function CallFullscreenPortal(props: ParentProps) {
  const presentation = useCallFullscreenOptional();
  const [home, setHome] = createSignal<HTMLDivElement>();
  if (!presentation) return props.children;
  return (
    <div ref={setHome} class="h-full min-h-0 w-full">
      <Show when={home()}>
        <Portal
          mount={
            presentation.fullscreen.active() ? presentation.host() : home()
          }
          ref={(element) => {
            element.className = 'relative size-full';
          }}
        >
          {props.children}
        </Portal>
      </Show>
    </div>
  );
}
