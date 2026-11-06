import { t } from '@app/lib/i18n';
import { usePending } from '@app/observability/flow';
import DesktopIcon from '@icon/system/regular/desktop.svg';
import { EmptyStatePanel } from '@ui';
import { createSignal, type JSX, Show } from 'solid-js';
import { ScreenToolbar } from '../components/screen-toolbar';
import type { ConnectScreen } from '../context/screen-context';
import { useScreen } from '../context/screen-context';
import { createScreenConnection } from '../primitives/screen-connection';

export function ScreenPane(props: {
  connect: ConnectScreen;
  requestControl?: JSX.Element;
}) {
  const screen = useScreen();
  const [target, setTarget] = createSignal<HTMLDivElement>();
  const connection = createScreenConnection(screen.host, target, props.connect);
  usePending(
    'computer.screen.connection',
    () => connection.status() === 'connecting'
  );
  return (
    <section
      aria-label={t('runtimeSharing.computerScreen')}
      class="flex size-full min-h-0 min-w-0 flex-col bg-panel text-ink"
    >
      <ScreenToolbar
        title={screen.host.title?.()}
        canControl={connection.canControl()}
        controlling={connection.controlling()}
        onToggleControl={connection.toggleControl}
        onClose={() => screen.setOpen(false)}
      />
      <Show when={connection.status() !== 'error'}>{props.requestControl}</Show>
      <Show when={connection.status() === 'connecting'}>
        <p role="status" class="p-2 text-sm text-ink-muted">
          {t('runtimeSharing.screenConnecting')}
        </p>
      </Show>
      <Show when={connection.status() === 'error'}>
        <div class="min-h-0 flex-1">
          <EmptyStatePanel
            centered
            graphic={DesktopIcon}
            graphicClass="h-12 w-12"
            title={t('runtimeSharing.screenDisconnected')}
            primaryAction={{
              label: t('runtimeSharing.screenRetry'),
              onClick: connection.retry,
            }}
          />
        </div>
      </Show>
      <div
        ref={setTarget}
        class="min-h-0 min-w-0 flex-1 overflow-hidden"
        classList={{ hidden: connection.status() === 'error' }}
      />
    </section>
  );
}
