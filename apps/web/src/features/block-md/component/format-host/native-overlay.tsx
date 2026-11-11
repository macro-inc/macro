import { HostedFloatingFormatMenu } from '@core/component/LexicalMarkdown/component/menu/FloatingFormatMenu';
import { FloatingMenuGroup } from '@core/component/LexicalMarkdown/context/FloatingMenuContext';
import { Telemetry } from '@macro-inc/observability';
import {
  type Accessor,
  type Component,
  createRoot,
  ErrorBoundary,
  Show,
} from 'solid-js';
import { createNativeDocumentFormattingObserver } from './native-observer';

/** Own only the optional body menu; the document owns its actual native view. */
export function createNativeBodyFormattingOverlay(options: {
  canEdit: Accessor<boolean>;
  alive: Accessor<boolean>;
}) {
  return createRoot((disposeRoot) => {
    const formatting = createNativeDocumentFormattingObserver(options);
    let disposed = false;
    const dispose = () => {
      if (disposed) return;
      disposed = true;
      disposeRoot();
    };
    const report = (error: unknown) => {
      try {
        Telemetry.error(error, { surface: 'native-format-menu' });
      } catch {
        // Optional presentation must not replace a document failure.
      }
    };
    const unavailable = (error: unknown) => {
      report(error);
      try {
        dispose();
      } catch (cleanupError) {
        report(cleanupError);
      }
    };
    const Overlay: Component = () => (
      <ErrorBoundary
        fallback={(error: unknown) => {
          unavailable(error);
          return null;
        }}
      >
        <FloatingMenuGroup>
          <Show when={formatting.controller()}>
            {(controller) => (
              <HostedFloatingFormatMenu
                host={controller().menu}
                options={{ showLinkButton: false }}
              />
            )}
          </Show>
        </FloatingMenuGroup>
      </ErrorBoundary>
    );
    return { observer: formatting.observer, Overlay, dispose };
  });
}
