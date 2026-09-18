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
  const [showTabBar, setShowTabBar] = pdf.state.signals.showTabBar;

  return (
    <Show when={canEdit()}>
      <Button
        size="icon-sm"
        label={showTabBar() ? 'Hide Tabs' : 'Show Tabs'}
        variant="ghost"
        onClick={() => {
          setShowTabBar(!showTabBar());
        }}
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
  const [documentProxy] = usePdfDocument().state.signals.documentProxy;
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
