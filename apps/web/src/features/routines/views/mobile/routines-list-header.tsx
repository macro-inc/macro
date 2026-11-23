import { ViewSidebar } from '@app/components/view-shell';
import { t } from '@app/lib/i18n';
import { MobileHeader } from '@components/app/mobile-header/mobile-header';
import SearchIcon from '@icon/system/regular/magnifying-glass.svg';
import PlusIcon from '@icon/system/regular/plus.svg';
import { Button } from '@ui';

export function MobileRoutinesListHeader(props: {
  onBack(): void;
  fromDrawer: boolean;
  onSearch(): void;
  onCreate(): void;
}) {
  return (
    <MobileHeader
      trailing={
        <>
          <MobileHeader.Island class="size-10 justify-center !px-0">
            <Button
              variant="ghost"
              size="icon-md"
              aria-label={t('agentWork.searchRoutines')}
              onClick={props.onSearch}
            >
              <SearchIcon class="size-5" />
            </Button>
          </MobileHeader.Island>
          <MobileHeader.Island class="size-10 justify-center !px-0">
            <Button
              variant="ghost"
              size="icon-md"
              aria-label={t('agentWork.createRoutine')}
              onClick={props.onCreate}
            >
              <PlusIcon class="size-5" />
            </Button>
          </MobileHeader.Island>
        </>
      }
    >
      {props.fromDrawer ? (
        <ViewSidebar.Toggle action="expand" presentation="pill" />
      ) : (
        <MobileHeader.Back onBack={props.onBack} />
      )}
    </MobileHeader>
  );
}
