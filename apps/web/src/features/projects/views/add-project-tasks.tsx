import { t } from '@app/lib/i18n';
import CaretDownIcon from '@icon/system/regular/caret-down.svg';
import ListPlusIcon from '@icon/system/regular/list-plus.svg';
import PlusIcon from '@icon/system/regular/plus.svg';
import { EditorPopover } from '@property/editors/popover/EditorPopover';
import { Dropdown, Hotkey, PillButton } from '@ui';
import { Show } from 'solid-js';
import type { AddProjectTasksViewProps } from '../add-project-tasks';

export function AddProjectTasksView(props: AddProjectTasksViewProps) {
  return (
    <Dropdown
      open={props.open}
      onOpenChange={props.onOpenChange}
      placement="bottom-end"
    >
      <Show
        when={props.inline}
        fallback={
          <Dropdown.Trigger variant="secondary" size="md">
            <PlusIcon class="size-4" />
            {props.canCreate
              ? t('viewMenus.addTask')
              : t('viewMenus.addExistingTasks')}
            <CaretDownIcon class="size-4" />
          </Dropdown.Trigger>
        }
      >
        <Dropdown.Trigger as={PillButton} tone="cta" icon={PlusIcon}>
          {t('viewMenus.addTask')} <CaretDownIcon class="size-4" />
        </Dropdown.Trigger>
      </Show>
      <Show when={props.open}>
        <Show
          when={props.mode === 'choices'}
          fallback={
            <EditorPopover onClose={props.close}>
              {props.picker()}
            </EditorPopover>
          }
        >
          <Dropdown.Content
            onKeyDown={(event) => {
              if (event.ctrlKey || event.metaKey || event.altKey) return;
              if (event.key.toLowerCase() !== 'c') return;
              event.preventDefault();
              event.stopPropagation();
              props.createTask();
            }}
          >
            <Dropdown.Group>
              <Dropdown.Item
                aria-label={t('viewMenus.newTask')}
                onSelect={props.createTask}
              >
                <PlusIcon class="size-4" /> {t('viewMenus.newTask')}
                <Hotkey shortcut="c" theme="clear" class="ml-auto" />
              </Dropdown.Item>
              <Dropdown.Item
                closeOnSelect={false}
                onSelect={props.chooseExisting}
              >
                <ListPlusIcon class="size-4" />{' '}
                {t('viewMenus.addExistingTasks')}
              </Dropdown.Item>
            </Dropdown.Group>
          </Dropdown.Content>
        </Show>
      </Show>
    </Dropdown>
  );
}
