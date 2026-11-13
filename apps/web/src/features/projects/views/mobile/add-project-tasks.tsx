import { FloatRegion } from '@components/app/mobile/float-regions/FloatRegion';
import { MobileCreateMenu } from '@components/app/mobile/MobileCreateMenu';
import { MobileDrawer } from '@components/app/mobile/MobileDrawer';
import CaretDownIcon from '@icon/system/regular/caret-down.svg';
import ListPlusIcon from '@icon/system/regular/list-plus.svg';
import PlusIcon from '@icon/system/regular/plus.svg';
import { PillButton } from '@ui';
import { Show } from 'solid-js';
import type { AddProjectTasksViewProps } from '../../add-project-tasks';

export function MobileAddProjectTasks(props: AddProjectTasksViewProps) {
  return (
    <MobileDrawer open={props.open} onOpenChange={props.onOpenChange}>
      <Show
        when={props.inline}
        fallback={
          <FloatRegion region="accessory">
            <div class="flex justify-end px-(--mobile-chrome-gutter) pointer-events-auto">
              <MobileCreateMenu
                label="Task"
                items={[
                  {
                    label: 'New task',
                    icon: PlusIcon,
                    onSelect: props.createTask,
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
        }
      >
        <MobileDrawer.Trigger as={PillButton} tone="cta" icon={PlusIcon}>
          Add task <CaretDownIcon class="size-4" />
        </MobileDrawer.Trigger>
      </Show>
      <MobileDrawer.Portal>
        <MobileDrawer.Overlay />
        <MobileDrawer.Content>
          <MobileDrawer.Handle />
          <MobileDrawer.Title class="px-6 pb-3 text-lg font-semibold">
            {props.mode === 'choices' ? 'Add task' : 'Add existing tasks'}
          </MobileDrawer.Title>
          <MobileDrawer.ScrollBody>
            <Show
              when={props.mode === 'choices'}
              fallback={props.pickerFields()}
            >
              <MobileDrawer.Section>
                <MobileDrawer.Item onClick={props.createTask}>
                  <PlusIcon class="size-5" /> New task
                </MobileDrawer.Item>
                <MobileDrawer.Item onClick={props.chooseExisting}>
                  <ListPlusIcon class="size-5" /> Add existing tasks
                </MobileDrawer.Item>
              </MobileDrawer.Section>
            </Show>
          </MobileDrawer.ScrollBody>
          <Show when={props.mode === 'existing'}>{props.pickerFooter()}</Show>
        </MobileDrawer.Content>
      </MobileDrawer.Portal>
    </MobileDrawer>
  );
}
