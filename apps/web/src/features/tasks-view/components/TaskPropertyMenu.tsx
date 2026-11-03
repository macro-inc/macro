import { t } from '@app/lib/i18n';
import { MobileDrawer } from '@components/app/mobile/MobileDrawer';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import CalendarIcon from '@icon/system/regular/calendar.svg';
import CaretDownIcon from '@icon/system/regular/caret-down.svg';
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
import { Dropdown, Tooltip } from '@ui';
import { For, Match, Show, Switch } from 'solid-js';
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
  icon: typeof VisibleIcon;
}[] = [
  {
    id: 'show',
    get label() {
      return t('viewMenus.showProperty');
    },
    icon: VisibleIcon,
  },
  {
    id: 'hide_when_empty',
    get label() {
      return t('viewMenus.hideWhenEmpty');
    },
    icon: ConditionalIcon,
  },
  {
    id: 'hide',
    get label() {
      return t('viewMenus.hideProperty');
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
  const hasMenu = modes.length > 2;
  const menuLabel = () =>
    t('viewMenus.propertyDisplayMenu', { property: props.property.label });
  const tooltip = () =>
    t('viewMenus.propertyDisplayTooltip', {
      property: props.property.label,
      mode: current().label,
    });
  const content = () => (
    <>
      <props.property.icon class="size-3 shrink-0" />
      <span class="truncate">{props.property.label}</span>
      <Show when={hasMenu}>
        <CaretDownIcon class="size-3 shrink-0" data-icon-motion="none" />
      </Show>
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
    <div data-mode={props.mode} class="group/property inline-flex max-w-full">
      <Tooltip.Root>
        <Switch>
          <Match when={!hasMenu}>
            <Tooltip.Trigger
              as="button"
              type="button"
              onClick={cycle}
              aria-label={props.property.label}
              aria-pressed={props.mode === 'show'}
              class="inline-flex h-6 min-w-0 items-center gap-1.5 rounded-full border border-edge-button bg-surface px-2 py-0 text-xs text-ink-muted outline-none select-none focus-visible:ring-2 focus-visible:ring-accent group-data-[mode=show]/property:bg-control group-data-[mode=show]/property:text-ink group-data-[mode=hide]/property:border-transparent group-data-[mode=hide]/property:text-ink-extra-muted touch:h-9"
            >
              {content()}
            </Tooltip.Trigger>
          </Match>
          <Match when={hasMenu && !isTouchDevice()}>
            <Dropdown placement="bottom-start" modal={false}>
              <Dropdown.Trigger
                as={Tooltip.Trigger}
                aria-label={menuLabel()}
                class="inline-flex h-6 min-w-0 w-auto items-center gap-1.5 rounded-full border border-edge-button bg-surface px-2 py-0 text-xs text-ink-muted outline-none select-none focus-visible:ring-2 focus-visible:ring-accent group-data-[mode=show]/property:bg-control group-data-[mode=show]/property:text-ink group-data-[mode=hide\_when\_empty]/property:border-dashed group-data-[mode=hide]/property:border-transparent group-data-[mode=hide]/property:text-ink-extra-muted touch:h-9"
              >
                {content()}
              </Dropdown.Trigger>
              <Dropdown.Content class="min-w-48 max-w-80">
                {options()}
              </Dropdown.Content>
            </Dropdown>
          </Match>
          <Match when={hasMenu && isTouchDevice()}>
            <MobileDrawer restoreFocus>
              <Tooltip.Trigger
                as={MobileDrawer.Trigger}
                aria-label={menuLabel()}
                class="inline-flex h-6 min-w-0 items-center gap-1.5 rounded-full border border-edge-button bg-surface px-2 py-0 text-xs text-ink-muted outline-none select-none focus-visible:ring-2 focus-visible:ring-accent group-data-[mode=show]/property:bg-control group-data-[mode=show]/property:text-ink group-data-[mode=hide\_when\_empty]/property:border-dashed group-data-[mode=hide]/property:border-transparent group-data-[mode=hide]/property:text-ink-extra-muted touch:h-9"
              >
                {content()}
              </Tooltip.Trigger>
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
          </Match>
        </Switch>
        <Tooltip.Portal>
          <Tooltip.Content>{tooltip()}</Tooltip.Content>
        </Tooltip.Portal>
      </Tooltip.Root>
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
    <div class="flex flex-row flex-wrap gap-1.5 px-2 py-1.5">
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
        <section aria-label={t('viewMenus.properties')} class="p-1.5">
          <div class="flex h-7 items-center px-2 text-xs text-ink-extra-muted">
            {t('viewMenus.properties')}
          </div>
          {pills()}
        </section>
      }
    >
      <section aria-label={t('viewMenus.properties')}>
        <MobileDrawer.Label>{t('viewMenus.properties')}</MobileDrawer.Label>
        <div class="px-4">{pills()}</div>
      </section>
    </Show>
  );
}
