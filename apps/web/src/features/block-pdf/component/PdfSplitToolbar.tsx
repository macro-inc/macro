import { SplitHeaderLeft } from '@components/app/split-layout/components/SplitHeader';
import { ENABLE_PDF_MARKUP } from '@core/constant/featureFlags';
import Tabs from '@icon/system/regular/tabs.svg';
import { Button } from '@ui';
import { Show } from 'solid-js';
import { usePdfDocument } from '../context/pdf-document-context';
import { MarkupToolbar } from './MarkupToolbar';
import { PageNumberInput } from './PageNumberInput';

export function PdfTabsToggle() {
  const pdf = usePdfDocument();
  const canEdit = pdf.permissions.canEdit;

  return (
    <Show when={canEdit()}>
      <Button
        size="icon-sm"
        label={pdf.tabs.isVisible() ? 'Hide Tabs' : 'Show Tabs'}
        variant="ghost"
        onClick={pdf.tabs.commands.toggleVisibility}
      >
        <Tabs />
      </Button>
    </Show>
  );
}

export function PdfToolbarControls() {
  return (
    <div class="flex items-center gap-2">
      <PageNumberInput />
      <Show when={ENABLE_PDF_MARKUP}>
        <div class="h-5 w-px bg-edge" />
        <MarkupToolbar />
      </Show>
    </div>
  );
}

/** Compact controls shared by standalone and Drive PDF title rows. */
export function PdfHeaderControls() {
  const documentProxy = usePdfDocument().documentProxy;
  return (
    <Show when={documentProxy()}>
      <div
        role="group"
        aria-label="PDF controls"
        class="ml-2 flex shrink-0 items-center gap-1 whitespace-nowrap"
      >
        <PdfToolbarControls />
        <PdfTabsToggle />
      </div>
    </Show>
  );
}

export function PdfSplitToolbar() {
  return (
    <SplitHeaderLeft>
      <PdfHeaderControls />
    </SplitHeaderLeft>
  );
}
