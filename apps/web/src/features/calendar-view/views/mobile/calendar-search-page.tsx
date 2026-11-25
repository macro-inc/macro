import { ViewShell } from '@app/components/view-shell';
import { MobileHeader } from '@components/app/mobile-header/mobile-header';
import { Layer } from '@ui';
import { CalendarSearch } from '../../components/CalendarSearch';

export function MobileCalendarSearchPage(props: { onBack: () => void }) {
  return (
    <ViewShell.Root aside={false}>
      <ViewShell.Main class="relative bg-page text-ink">
        <ViewShell.TopBar
          touch
          navigation={<MobileHeader.Back onBack={props.onBack} />}
        />
        <Layer depth={2}>
          <div class="flex min-h-0 flex-1 flex-col pt-[var(--mobile-content-inset-top,0px)] pb-[var(--mobile-content-inset-bottom,0px)]">
            <CalendarSearch page />
          </div>
        </Layer>
      </ViewShell.Main>
    </ViewShell.Root>
  );
}
