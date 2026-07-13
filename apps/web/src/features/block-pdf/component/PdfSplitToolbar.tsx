import { showTabBarSignal } from '@block-pdf/signal/placeables';
import {
  SplitToolbarLeft,
  SplitToolbarRight,
} from '@components/app/split-layout/components/SplitToolbar';
import { ENABLE_PDF_MARKUP } from '@core/constant/featureFlags';
import { useCanEdit } from '@core/signal/permissions';
import Tabs from '@phosphor/tabs.svg';
import { Button } from '@ui';
import { Show } from 'solid-js';
import { pdfDocumentProxy } from '../signal/document';
import { MarkupToolbar } from './MarkupToolbar';
import { PageNumberInput } from './PageNumberInput';

function TabsToggle() {
  const canEdit = useCanEdit();
  const [showTabBar, setShowTabBar] = showTabBarSignal;

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

export function PdfSplitToolbar() {
  return (
    <Show when={pdfDocumentProxy()}>
      <SplitToolbarLeft>
        <div class="flex items-center gap-2">
          <PageNumberInput />
          <Show when={ENABLE_PDF_MARKUP}>
            <div class="h-5 w-px bg-edge" />
            <MarkupToolbar />
          </Show>
        </div>
      </SplitToolbarLeft>
      <SplitToolbarRight>
        <TabsToggle />
      </SplitToolbarRight>
    </Show>
  );
}
