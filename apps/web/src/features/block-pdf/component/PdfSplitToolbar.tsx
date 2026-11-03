import {
  SplitToolbarLeft,
  SplitToolbarRight,
} from '@components/app/split-layout/components/SplitToolbar';
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
        aria-label={pdf.tabs.isVisible() ? 'Hide Tabs' : 'Show Tabs'}
        tooltip={pdf.tabs.isVisible() ? 'Hide Tabs' : 'Show Tabs'}
        size="icon-sm"
        variant="ghost"
        onClick={pdf.tabs.commands.toggleVisibility}
      >
        <Tabs class="size-3.5 touch:size-6 shrink-0 pointer-events-none" />
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

export function PdfSplitToolbar() {
  const documentProxy = usePdfDocument().documentProxy;
  return (
    <Show when={documentProxy()}>
      <SplitToolbarLeft>
        <PdfToolbarControls />
      </SplitToolbarLeft>
      <SplitToolbarRight>
        <PdfTabsToggle />
      </SplitToolbarRight>
    </Show>
  );
}
