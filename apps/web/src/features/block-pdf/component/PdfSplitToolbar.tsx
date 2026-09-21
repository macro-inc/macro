import {
  SplitToolbarLeft,
  SplitToolbarRight,
} from '@components/app/split-layout/components/SplitToolbar';
import { ENABLE_PDF_MARKUP } from '@core/constant/featureFlags';
import Tabs from '@phosphor/tabs.svg';
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
