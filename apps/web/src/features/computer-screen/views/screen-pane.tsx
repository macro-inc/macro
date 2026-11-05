import { Button } from '@ui';
import { createSignal, Show } from 'solid-js';
import { ScreenToolbar } from '../components/screen-toolbar';
import type { ConnectScreen } from '../context/screen-context';
import { useScreen } from '../context/screen-context';
import { createScreenConnection } from '../primitives/screen-connection';

export function ScreenPane(props: { connect: ConnectScreen }) {
  const screen = useScreen();
  const [target, setTarget] = createSignal<HTMLDivElement>();
  const connection = createScreenConnection(screen.host, target, props.connect);
  return (
    <section
      aria-label="Computer screen"
      class="flex size-full min-h-0 min-w-0 flex-col bg-panel text-ink"
    >
      <ScreenToolbar
        canControl={connection.canControl()}
        controlling={connection.controlling()}
        onToggleControl={connection.toggleControl}
        onClose={() => screen.setOpen(false)}
      />
      <Show when={connection.status() === 'connecting'}>
        <p role="status" class="p-2 text-sm text-ink-muted">
          Connecting to screen…
        </p>
      </Show>
      <Show when={connection.status() === 'error'}>
        <div
          role="alert"
          class="flex flex-wrap items-center gap-2 p-2 text-sm text-failure"
        >
          Screen disconnected or unavailable.
          <Button size="sm" variant="secondary" onClick={connection.retry}>
            Retry
          </Button>
        </div>
      </Show>
      <div ref={setTarget} class="min-h-0 min-w-0 flex-1 overflow-hidden" />
    </section>
  );
}
