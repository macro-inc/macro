import { t } from '@app/lib/i18n';
import CheckIcon from '@icon/system/regular/check.svg';
import { Dropdown, Tabs } from '@ui';
import { For, Match, Switch } from 'solid-js';
import { sceneSwitcher } from '../core/scenes';

/** The tab value for the artifact's own `index.html`; never a scene slug. */
export const OVERVIEW_TAB = ':overview';

export type SceneOption = { id: string; title: string };

export function SceneSwitcher(props: {
  scenes: readonly SceneOption[];
  selected: string | undefined;
  onSelect: (sceneId: string | undefined) => void;
}) {
  const options = () => [
    { value: OVERVIEW_TAB, label: t('artifacts.overview') },
    ...props.scenes.map((scene) => ({ value: scene.id, label: scene.title })),
  ];
  const select = (value: string) =>
    props.onSelect(value === OVERVIEW_TAB ? undefined : value);
  return (
    <Switch>
      <Match when={sceneSwitcher(props.scenes.length) === 'tabs'}>
        <Tabs
          aria-label={t('artifacts.scenes')}
          size="sm"
          options={options()}
          value={props.selected ?? OVERVIEW_TAB}
          onChange={select}
        />
      </Match>
      <Match when={sceneSwitcher(props.scenes.length) === 'select'}>
        <SceneDropdown {...props} />
      </Match>
    </Switch>
  );
}

/** Scenes as a menu, for many scenes or a narrow place such as an inspector. */
export function SceneDropdown(props: {
  scenes: readonly SceneOption[];
  selected: string | undefined;
  onSelect: (sceneId: string | undefined) => void;
  class?: string;
}) {
  const options = () => [
    { value: OVERVIEW_TAB, label: t('artifacts.overview') },
    ...props.scenes.map((scene) => ({ value: scene.id, label: scene.title })),
  ];
  const selectedLabel = () =>
    props.scenes.find((scene) => scene.id === props.selected)?.title ??
    t('artifacts.overview');
  return (
    <Dropdown>
      <Dropdown.Trigger class={props.class} aria-label={t('artifacts.scenes')}>
        <span class="max-w-60 truncate">{selectedLabel()}</span>
      </Dropdown.Trigger>
      <Dropdown.Content class="min-w-56 max-w-80">
        <Dropdown.Group>
          <Dropdown.RadioGroup
            value={props.selected ?? OVERVIEW_TAB}
            onChange={(value) =>
              props.onSelect(value === OVERVIEW_TAB ? undefined : value)
            }
          >
            <For each={options()}>
              {(option) => (
                <Dropdown.RadioItem value={option.value} closeOnSelect>
                  <Dropdown.ItemLabel class="flex-1 truncate">
                    {option.label}
                  </Dropdown.ItemLabel>
                  <Dropdown.ItemIndicator>
                    <CheckIcon class="size-3.5 text-accent" />
                  </Dropdown.ItemIndicator>
                </Dropdown.RadioItem>
              )}
            </For>
          </Dropdown.RadioGroup>
        </Dropdown.Group>
      </Dropdown.Content>
    </Dropdown>
  );
}
