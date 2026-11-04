import { t } from '@app/lib/i18n';
import SlidersIcon from '@icon/system/regular/sliders-horizontal.svg';
import { Button, Dropdown } from '@ui';
import { Show } from 'solid-js';
import type { PeopleVisibility } from '../context/workspace-context';

export function PeopleDisplayMenu(props: { visibility: PeopleVisibility }) {
  return (
    <Show when={props.visibility.canShowRemoved()}>
      <Dropdown>
        <Dropdown.Trigger
          as={Button}
          aria-label={t('viewMenus.peopleDisplayOptions')}
          tooltip={t('viewMenus.peopleDisplayOptions')}
          variant="ghost"
          size="icon-md"
        >
          <SlidersIcon class="size-4 touch:size-6 shrink-0 pointer-events-none" />
        </Dropdown.Trigger>
        <Dropdown.Content class="min-w-56 max-w-[calc(100vw-2rem)]">
          <Dropdown.CheckboxItem
            checked={props.visibility.showRemoved()}
            onChange={props.visibility.setShowRemoved}
            closeOnSelect={false}
          >
            <span class="flex-1 truncate">
              {t('viewMenus.showRemovedPeople')}
            </span>
          </Dropdown.CheckboxItem>
        </Dropdown.Content>
      </Dropdown>
    </Show>
  );
}

export function RemovedPeopleNotice(props: { onShowActive(): void }) {
  return (
    <div class="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2 text-xs text-ink-muted border-b border-edge-muted">
      <p class="min-w-0 flex-1">{t('viewMenus.removedPeopleDescription')}</p>
      <Button variant="ghost" size="sm" onClick={props.onShowActive}>
        {t('viewMenus.showActivePeople')}
      </Button>
    </div>
  );
}
