import { FloatRegion } from '@components/app/mobile/float-regions/FloatRegion';
import { MobileCreateMenu } from '@components/app/mobile/MobileCreateMenu';
import { MobileDrawer } from '@components/app/mobile/MobileDrawer';
import ListPlusIcon from '@icon/system/regular/list-plus.svg';
import PlusIcon from '@icon/system/regular/plus.svg';
import type { AddProjectTasksViewProps } from '../../add-project-tasks';

export function MobileAddProjectTasks(props: AddProjectTasksViewProps) {
  return (
    <MobileDrawer open={props.open} onOpenChange={props.onOpenChange}>
      <FloatRegion region="accessory">
        <div class="flex h-(--mobile-chrome-button-size) justify-end px-(--mobile-chrome-gutter) pointer-events-auto">
          <MobileCreateMenu
            label="Task"
            items={[
              {
                label: 'New task',
                icon: PlusIcon,
                onSelect: props.createTask,
                disabled: !props.canCreate,
              },
              {
                label: 'Add existing tasks',
                icon: ListPlusIcon,
                onSelect: props.openExisting,
              },
            ]}
          />
        </div>
      </FloatRegion>
      <MobileDrawer.Portal>
        <MobileDrawer.Overlay />
        <MobileDrawer.Content targetHeight={80}>
          <MobileDrawer.Handle class="pt-3 pb-4" />
          <MobileDrawer.Title class="px-6 pb-3 text-lg font-semibold">
            Add existing tasks
          </MobileDrawer.Title>
          {props.pickerFields('sheet')}
          {props.pickerFooter('sheet')}
        </MobileDrawer.Content>
      </MobileDrawer.Portal>
    </MobileDrawer>
  );
}
