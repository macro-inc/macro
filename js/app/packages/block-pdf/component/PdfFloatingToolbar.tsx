import { ScopedPortal } from '@core/component/ScopedPortal';
import { ENABLE_PDF_MARKUP } from '@core/constant/featureFlags';
import { isMobile } from '@core/mobile/isMobile';
import { Show } from 'solid-js';
import { pdfDocumentProxy } from '../signal/document';
import { MarkupToolbar } from './MarkupToolbar';
import { PageNumberInput } from './PageNumberInput';

export function PdfFloatingToolbar() {
  return (
    <ScopedPortal scope="local">
      <Show when={pdfDocumentProxy()}>
        <div class="pointer-events-none absolute left-3 top-1 z-action-menu mobile:left-2 mobile:top-0">
          <div class="pointer-events-auto flex min-h-10 items-center gap-1 rounded-xl border border-edge-muted bg-surface/95 px-2 py-1 shadow-lg shadow-drop-shadow backdrop-blur">
            <Show when={!isMobile()}>
              <div class="w-1" />
            </Show>
            <PageNumberInput />
            <Show when={ENABLE_PDF_MARKUP}>
              <div class="h-5 w-px bg-edge mx-1" />
              <MarkupToolbar />
            </Show>
          </div>
        </div>
      </Show>
    </ScopedPortal>
  );
}
