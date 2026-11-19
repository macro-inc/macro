import { t } from '@app/lib/i18n';
import { activeElement } from '@app/signal/focus';
import { FloatRegion } from '@components/app/mobile/float-regions/FloatRegion';
import { MobileCreateMenu } from '@components/app/mobile/MobileCreateMenu';
import { MobileDrawer } from '@components/app/mobile/MobileDrawer';
import { PickerSheet } from '@components/app/mobile/PickerSheet';
import { virtualKeyboardVisible } from '@core/mobile/virtualKeyboard';
import { isEditableInput } from '@core/util/isEditableInput';
import ListPlusIcon from '@icon/system/regular/list-plus.svg';
import PlusIcon from '@icon/system/regular/plus.svg';
import type { AddProjectTasksViewProps } from '../../add-project-tasks';

export function MobileAddProjectTasks(props: AddProjectTasksViewProps) {
  return (
    <>
      <FloatRegion
        region="accessory"
        active={() =>
          !virtualKeyboardVisible() && !isEditableInput(activeElement())
        }
      >
        <div class="flex h-(--mobile-chrome-button-size) justify-end px-(--mobile-chrome-gutter) pointer-events-auto">
          <MobileCreateMenu
            label={t('viewMenus.task')}
            items={[
              {
                label: t('viewMenus.newTask'),
                icon: PlusIcon,
                onSelect: props.createTask,
                disabled: !props.canCreate,
              },
              {
                label: t('viewMenus.addExistingTasks'),
                icon: ListPlusIcon,
                onSelect: props.openExisting,
              },
            ]}
          />
        </div>
      </FloatRegion>
      <PickerSheet.Root open={props.open} onCancel={props.close}>
        <MobileDrawer.Title class="px-6 pt-4 pb-3 text-lg font-semibold">
          {t('viewMenus.addExistingTasks')}
        </MobileDrawer.Title>
        <PickerSheet.Body>{props.pickerFields('sheet')}</PickerSheet.Body>
        {props.pickerFooter('sheet')}
      </PickerSheet.Root>
    </>
  );
}
