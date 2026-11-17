import { ViewSidebar } from '@app/components/view-shell';
import { t } from '@app/lib/i18n';
import PlusIcon from '@icon/system/regular/plus.svg';

/** The final row below a consumer's built-in and saved views. */
export function SavedViewCreateButton(props: {
  onCreate: () => void;
  ref?: (element: HTMLButtonElement) => void;
}) {
  return (
    <ViewSidebar.Item ref={props.ref} onClick={props.onCreate}>
      <ViewSidebar.Icon>
        <PlusIcon class="size-4" />
      </ViewSidebar.Icon>
      {t('viewMenus.createSavedView')}
    </ViewSidebar.Item>
  );
}
