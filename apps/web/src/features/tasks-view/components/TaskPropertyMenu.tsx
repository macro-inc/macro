import { t } from '@app/lib/i18n';
import { MobileDrawer } from '@components/app/mobile/MobileDrawer';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import CalendarIcon from '@icon/system/regular/calendar.svg';
import CheckIcon from '@icon/system/regular/check.svg';
import ConditionalIcon from '@icon/system/regular/circle-half.svg';
import ClockIcon from '@icon/system/regular/clock.svg';
import ProjectIcon from '@icon/system/regular/cube.svg';
import VisibleIcon from '@icon/system/regular/eye.svg';
import HiddenIcon from '@icon/system/regular/eye-slash.svg';
import TagIcon from '@icon/system/regular/tag.svg';
import UserPlusIcon from '@icon/system/regular/user-plus.svg';
import UsersIcon from '@icon/system/regular/users.svg';
import PriorityIcon from '@icon/wide-priority-high.svg';
import { Button, Dropdown } from '@ui';
import { For, Show } from 'solid-js';
import { Dynamic } from 'solid-js/web';
import {
  type TaskPropertyDisplay,
  type TaskPropertyDisplayMode,
  type TaskPropertyId,
  taskPropertyDisplaySchema,
} from '../core/task-property-display';

type DisplayProperty = {
  id: TaskPropertyId;
  readonly label: string;
  icon: typeof CalendarIcon;
};

export const TASK_DISPLAY_PROPERTIES: readonly DisplayProperty[] = [
  {
    id: 'priority',
    get label() {
      return t('viewMenus.priority');
    },
    icon: PriorityIcon,
  },
  {
    id: 'tags',
    get label() {
      return t('viewMenus.tags');
    },
    icon: TagIcon,
  },
  {
    id: 'dueDate',
    get label() {
      return t('viewMenus.dueDate');
    },
    icon: CalendarIcon,
  },
  {
    id: 'project',
    get label() {
      return t('viewMenus.project');
    },
    icon: ProjectIcon,
  },
  {
    id: 'assignees',
    get label() {
      return t('viewMenus.assignees');
    },
    icon: UsersIcon,
  },
  {
    id: 'updated',
    get label() {
      return t('viewMenus.sortUpdated');
    },
    icon: ClockIcon,
  },
  {
    id: 'createdBy',
    get label() {
      return t('viewMenus.createdBy');
    },
    icon: UserPlusIcon,
  },
];

const DISPLAY_MODES: readonly {
  id: TaskPropertyDisplayMode;
  readonly label: string;
  readonly description: string;
  icon: typeof VisibleIcon;
}[] = [
  {
    id: 'show',
    get label() {
      return t('viewMenus.showProperty');
    },
    get description() {
      return t('viewMenus.showPropertyDescription');
    },
    icon: VisibleIcon,
  },
  {
    id: 'hide_when_empty',
    get label() {
      return t('viewMenus.hideWhenEmpty');
    },
    get description() {
      return t('viewMenus.hideWhenEmptyDescription');
    },
    icon: ConditionalIcon,
  },
  {
    id: 'hide',
    get label() {
      return t('viewMenus.hideProperty');
    },
    get description() {
      return t('viewMenus.hidePropertyDescription');
    },
    icon: HiddenIcon,
  },
];

export function taskPropertyModeLabel(mode: TaskPropertyDisplayMode) {
  return DISPLAY_MODES.find((option) => option.id === mode)?.label;
}

function TaskPropertyPill(props: {
  property: DisplayProperty;
  mode: TaskPropertyDisplayMode;
  onChange: (mode: TaskPropertyDisplayMode) => void;
}) {
  const modes = DISPLAY_MODES.filter(
    (mode) =>
      taskPropertyDisplaySchema.shape[props.property.id].safeParse(mode.id)
        .success
  );
  const current = () =>
    modes.find((mode) => mode.id === props.mode) ?? modes[0];
  const next = () =>
    modes[
      (modes.findIndex((mode) => mode.id === props.mode) + 1) % modes.length
    ];
  const cycle = () => props.onChange(next().id);
  const label = () =>
    t('viewMenus.propertyDisplayAction', {
      property: props.property.label,
      mode: current().label,
      nextMode: next().label,
    });
  const tooltip = () =>
    t('viewMenus.propertyDisplayTooltip', {
      property: props.property.label,
      mode: current().label,
      description: current().description,
      nextMode: next().label,
    });
  const menuLabel = () =>
    t('viewMenus.propertyDisplayMenu', { property: props.property.label });
  const content = () => (
    <>
      <props.property.icon class="size-3.5 shrink-0" />
      <span
        class="truncate"
        classList={{ 'opacity-50': props.mode === 'hide' }}
      >
        {props.property.label}
      </span>
    </>
  );
  const options = () => (
    <Dropdown.Group>
      <Dropdown.RadioGroup
        value={props.mode}
        onChange={(value) => {
          const mode = modes.find((mode) => mode.id === value);
          if (mode) props.onChange(mode.id);
        }}
      >
        <For each={modes}>
          {(mode) => (
            <Dropdown.RadioItem value={mode.id} closeOnSelect={false}>
              <mode.icon class="size-4 shrink-0" data-icon-motion="none" />
              <span class="flex-1">{mode.label}</span>
              <Dropdown.ItemIndicator>
                <CheckIcon class="size-3.5 text-accent" />
              </Dropdown.ItemIndicator>
            </Dropdown.RadioItem>
          )}
        </For>
      </Dropdown.RadioGroup>
    </Dropdown.Group>
  );

  return (
    <div class="group/property relative inline-flex max-w-full">
      <Show
        when={isTouchDevice()}
        fallback={
          <Button
            variant="secondary"
            finish="flat"
            size="sm"
            as={Dropdown.Item}
            role="menuitem"
            tabIndex={-1}
            closeOnSelect={false}
            onSelect={cycle}
            textValue={props.property.label}
            aria-label={label()}
            tooltip={tooltip()}
            class="min-w-0 w-auto shrink touch:pr-10"
          >
            {content()}
          </Button>
        }
      >
        <Button
          variant="secondary"
          finish="flat"
          size="sm"
          onClick={cycle}
          aria-label={label()}
          tooltip={tooltip()}
          class="min-w-0 shrink touch:pr-10"
        >
          {content()}
        </Button>
      </Show>
      <div class="absolute inset-y-0 right-0 z-1 flex items-center rounded-full bg-surface not-touch:invisible not-touch:group-hover/property:visible not-touch:group-focus-within/property:visible has-[[data-expanded]]:visible has-[[data-highlighted]]:visible">
        <Show
          when={isTouchDevice()}
          fallback={
            <Dropdown.Sub>
              <Button
                variant="ghost"
                as={Dropdown.SubTrigger}
                role="menuitem"
                tabIndex={-1}
                size="icon-sm"
                aria-label={menuLabel()}
                textValue={menuLabel()}
                tooltip={menuLabel()}
              >
                <Dynamic
                  component={current().icon}
                  class="size-3.5"
                  data-icon-motion="none"
                />
              </Button>
              <Dropdown.SubContent class="min-w-48 max-w-80">
                {options()}
              </Dropdown.SubContent>
            </Dropdown.Sub>
          }
        >
          <MobileDrawer restoreFocus>
            <MobileDrawer.Trigger
              as={Button}
              variant="ghost"
              size="icon-sm"
              aria-label={menuLabel()}
              tooltip={menuLabel()}
            >
              <Dynamic
                component={current().icon}
                class="size-3.5"
                data-icon-motion="none"
              />
            </MobileDrawer.Trigger>
            <MobileDrawer.Portal>
              <MobileDrawer.Overlay />
              <MobileDrawer.Content>
                <MobileDrawer.Handle />
                <MobileDrawer.Title class="px-6 pb-4 text-lg font-semibold">
                  {menuLabel()}
                </MobileDrawer.Title>
                <MobileDrawer.ScrollBody>
                  <MobileDrawer.Section
                    role="radiogroup"
                    aria-label={props.property.label}
                  >
                    <For each={modes}>
                      {(mode) => (
                        <MobileDrawer.Item
                          role="radio"
                          aria-checked={props.mode === mode.id}
                          onClick={() => props.onChange(mode.id)}
                        >
                          <mode.icon
                            class="size-4 shrink-0"
                            data-icon-motion="none"
                          />
                          <span class="flex-1">{mode.label}</span>
                          <Show when={props.mode === mode.id}>
                            <CheckIcon class="size-4 shrink-0 text-accent" />
                          </Show>
                        </MobileDrawer.Item>
                      )}
                    </For>
                  </MobileDrawer.Section>
                </MobileDrawer.ScrollBody>
              </MobileDrawer.Content>
            </MobileDrawer.Portal>
          </MobileDrawer>
        </Show>
      </div>
    </div>
  );
}

export function TaskPropertyMenu(props: {
  display: TaskPropertyDisplay;
  showProject: boolean;
  onChange: (property: TaskPropertyId, mode: TaskPropertyDisplayMode) => void;
}) {
  const properties = () =>
    TASK_DISPLAY_PROPERTIES.filter(
      (property) => property.id !== 'project' || props.showProject
    );
  const pills = () => (
    <div class="flex flex-row flex-wrap gap-2 px-2 py-1.5">
      <For each={properties()}>
        {(property) => (
          <TaskPropertyPill
            property={property}
            mode={props.display[property.id]}
            onChange={(mode) => props.onChange(property.id, mode)}
          />
        )}
      </For>
    </div>
  );

  return (
    <Show
      when={isTouchDevice()}
      fallback={
        <Dropdown.Group>
          <Dropdown.GroupLabel>{t('viewMenus.properties')}</Dropdown.GroupLabel>
          {pills()}
        </Dropdown.Group>
      }
    >
      <section aria-label={t('viewMenus.properties')}>
        <MobileDrawer.Label>{t('viewMenus.properties')}</MobileDrawer.Label>
        <div class="px-4">{pills()}</div>
      </section>
    </Show>
  );
}
