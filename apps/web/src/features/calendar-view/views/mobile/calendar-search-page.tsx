import { ViewShell } from '@app/components/view-shell';
import { t } from '@app/lib/i18n';
import CaretLeft from '@icon/system/regular/caret-left.svg';
import { Button, Layer } from '@ui';
import { createSignal } from 'solid-js';
import { CalendarSearch } from '../../components/CalendarSearch';

export function MobileCalendarSearchPage(props: { onBack: () => void }) {
  const [headerMount, setHeaderMount] = createSignal<HTMLDivElement>();
  return (
    <ViewShell.Root aside={false}>
      <ViewShell.Main class="relative bg-page text-ink">
        <ViewShell.TopBar
          touch
          navigation={
            <ViewShell.TopBarIsland>
              <Button
                variant="ghost"
                size="icon-md"
                aria-label={t('calendar.backToCalendar')}
                onClick={props.onBack}
              >
                <CaretLeft class="size-6" />
              </Button>
            </ViewShell.TopBarIsland>
          }
        >
          <ViewShell.TopBarTitle>
            <div ref={setHeaderMount} class="flex min-w-0 flex-1" />
          </ViewShell.TopBarTitle>
        </ViewShell.TopBar>
        <Layer depth={2}>
          <div class="flex min-h-0 flex-1 flex-col pt-[var(--mobile-content-inset-top,0px)] pb-[var(--mobile-content-inset-bottom,0px)]">
            <CalendarSearch page headerMount={headerMount()} />
          </div>
        </Layer>
      </ViewShell.Main>
    </ViewShell.Root>
  );
}
