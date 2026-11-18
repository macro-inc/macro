import { MobileHeader } from '@components/app/mobile-header/mobile-header';
import SearchIcon from '@icon/system/regular/magnifying-glass.svg';
import PlusIcon from '@icon/system/regular/plus.svg';
import { Button } from '@ui';

export function MobileRoutinesListHeader(props: {
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
              aria-label="Search routines"
              onClick={props.onSearch}
            >
              <SearchIcon class="size-5" />
            </Button>
          </MobileHeader.Island>
          <MobileHeader.Island class="size-10 justify-center !px-0">
            <Button
              variant="ghost"
              size="icon-md"
              aria-label="Create Routine"
              onClick={props.onCreate}
            >
              <PlusIcon class="size-5" />
            </Button>
          </MobileHeader.Island>
        </>
      }
    >
      <MobileHeader.Title label="Routines" />
    </MobileHeader>
  );
}
