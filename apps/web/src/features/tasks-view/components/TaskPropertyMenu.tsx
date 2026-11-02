import { t } from '@app/lib/i18n';
import { MobileDrawer } from '@components/app/mobile/MobileDrawer';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import CaretRightIcon from '@icon/system/regular/caret-right.svg';
import CheckIcon from '@icon/system/regular/check.svg';
import { Dropdown } from '@ui';
import { createSignal, createUniqueId, For, Show } from 'solid-js';
import {
  type TaskPropertyDisplay,
  type TaskPropertyDisplayMode,
  type TaskPropertyId,
  taskPropertyDisplaySchema,
} from '../core/task-property-display';

export const TASK_DISPLAY_PROPERTIES: readonly {
  id: TaskPropertyId;
  readonly label: string;
}[] = [
  {
    id: 'priority',
    get label() {
      return t('viewMenus.priority');
    },
  },
  {
    id: 'tags',
    get label() {
      return t('viewMenus.tags');
    },
  },
  {
    id: 'dueDate',
    get label() {
      return t('viewMenus.dueDate');
    },
  },
  {
    id: 'project',
    get label() {
      return t('viewMenus.project');
    },
  },
  {
    id: 'assignees',
    get label() {
      return t('viewMenus.assignees');
    },
  },
  {
    id: 'updated',
    get label() {
      return t('viewMenus.sortUpdated');
    },
  },
  {
    id: 'createdBy',
    get label() {
      return t('viewMenus.createdBy');
    },
  },
];

const DISPLAY_MODES: readonly {
  id: TaskPropertyDisplayMode;
  readonly label: string;
}[] = [
  {
    id: 'show',
    get label() {
      return t('viewMenus.showProperty');
    },
  },
  {
    id: 'hide_when_empty',
    get label() {
      return t('viewMenus.hideWhenEmpty');
    },
  },
  {
    id: 'hide',
    get label() {
      return t('viewMenus.hideProperty');
    },
  },
];

export function taskPropertyModeLabel(mode: TaskPropertyDisplayMode) {
  return DISPLAY_MODES.find((option) => option.id === mode)?.label;
}

export function TaskPropertyMenu(props: {
  display: TaskPropertyDisplay;
  showProject: boolean;
  onChange: (property: TaskPropertyId, mode: TaskPropertyDisplayMode) => void;
}) {
  const [expanded, setExpanded] = createSignal<TaskPropertyId>();
  const id = createUniqueId();
  const properties = () =>
    TASK_DISPLAY_PROPERTIES.filter(
      (property) => property.id !== 'project' || props.showProject
    );
  const modes = (property: TaskPropertyId) =>
    DISPLAY_MODES.filter(
      (mode) =>
        taskPropertyDisplaySchema.shape[property].safeParse(mode.id).success
    );

  return (
    <Show
      when={isTouchDevice()}
      fallback={
        <Dropdown.Group>
          <Dropdown.GroupLabel>{t('viewMenus.properties')}</Dropdown.GroupLabel>
          <For each={properties()}>
            {(property) => (
              <Dropdown.Sub>
                <Dropdown.SubTrigger>
                  <span class="flex-1">{property.label}</span>
                  <span class="text-ink-muted">
                    {taskPropertyModeLabel(props.display[property.id])}
                  </span>
                  <CaretRightIcon class="size-3 shrink-0 text-ink-muted" />
                </Dropdown.SubTrigger>
                <Dropdown.SubContent class="min-w-48 max-w-80">
                  <Dropdown.Group>
                    <Dropdown.RadioGroup
                      value={props.display[property.id]}
                      onChange={(value) => {
                        const mode = modes(property.id).find(
                          (mode) => mode.id === value
                        );
                        if (mode) props.onChange(property.id, mode.id);
                      }}
                    >
                      <For each={modes(property.id)}>
                        {(mode) => (
                          <Dropdown.RadioItem
                            value={mode.id}
                            closeOnSelect={false}
                          >
                            <span class="flex-1">{mode.label}</span>
                            <Dropdown.ItemIndicator>
                              <CheckIcon class="size-3.5 text-accent" />
                            </Dropdown.ItemIndicator>
                          </Dropdown.RadioItem>
                        )}
                      </For>
                    </Dropdown.RadioGroup>
                  </Dropdown.Group>
                </Dropdown.SubContent>
              </Dropdown.Sub>
            )}
          </For>
        </Dropdown.Group>
      }
    >
      <div>
        <MobileDrawer.Label>{t('viewMenus.properties')}</MobileDrawer.Label>
        <MobileDrawer.Section>
          <For each={properties()}>
            {(property) => (
              <div>
                <MobileDrawer.Item
                  aria-expanded={expanded() === property.id}
                  aria-controls={`${id}-${property.id}`}
                  onClick={() =>
                    setExpanded((current) =>
                      current === property.id ? undefined : property.id
                    )
                  }
                >
                  <span class="flex-1">{property.label}</span>
                  <span class="text-ink-muted">
                    {taskPropertyModeLabel(props.display[property.id])}
                  </span>
                  <CaretRightIcon
                    class="size-4 shrink-0 text-ink-muted"
                    classList={{ 'rotate-90': expanded() === property.id }}
                  />
                </MobileDrawer.Item>
                <Show when={expanded() === property.id}>
                  <div
                    id={`${id}-${property.id}`}
                    role="radiogroup"
                    aria-label={property.label}
                  >
                    <For each={modes(property.id)}>
                      {(mode) => (
                        <MobileDrawer.Item
                          role="radio"
                          aria-checked={props.display[property.id] === mode.id}
                          onClick={() => props.onChange(property.id, mode.id)}
                        >
                          <span class="flex-1">{mode.label}</span>
                          <Show when={props.display[property.id] === mode.id}>
                            <CheckIcon class="size-4 shrink-0 text-accent" />
                          </Show>
                        </MobileDrawer.Item>
                      )}
                    </For>
                  </div>
                </Show>
              </div>
            )}
          </For>
        </MobileDrawer.Section>
      </div>
    </Show>
  );
}
