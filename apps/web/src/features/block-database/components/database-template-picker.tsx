import BooksIcon from '@phosphor/books.svg';
import CalendarIcon from '@phosphor/calendar.svg';
import ChecksIcon from '@phosphor/checks.svg';
import ConfettiIcon from '@phosphor/confetti.svg';
import ForkKnifeIcon from '@phosphor/fork-knife.svg';
import KanbanIcon from '@phosphor/kanban.svg';
import MapTrifoldIcon from '@phosphor/map-trifold.svg';
import SparkleIcon from '@phosphor/sparkle.svg';
import TableIcon from '@phosphor/table.svg';
import type { DatabaseTemplateIcon } from '@service-storage/generated/schemas/databaseTemplateIcon';
import { Button } from '@ui/components/Button';
import { Dialog } from '@ui/components/Dialog';
import { Panel } from '@ui/components/Panel';
import { RadioGroup } from '@ui/components/RadioGroup';
import {
  type Component,
  type ComponentProps,
  createSignal,
  For,
  Match,
  Show,
  Switch,
} from 'solid-js';
import { Dynamic } from 'solid-js/web';
import { match } from 'ts-pattern';
import {
  BLANK_DATABASE,
  type DatabaseCreation,
  type DatabaseTemplates,
  templateDatabase,
} from '../core/database-creation';
import { DatabaseTemplatePreview } from './database-template-preview';

type PickerOption = {
  key: string;
  name: string;
  description: string;
  icon: Component<ComponentProps<'svg'>>;
  creation: DatabaseCreation;
};

function templateIcon(
  icon: DatabaseTemplateIcon
): Component<ComponentProps<'svg'>> {
  return match(icon)
    .with('sparkle', () => SparkleIcon)
    .with('kanban', () => KanbanIcon)
    .with('confetti', () => ConfettiIcon)
    .with('calendar', () => CalendarIcon)
    .with('books', () => BooksIcon)
    .with('map_trifold', () => MapTrifoldIcon)
    .with('checks', () => ChecksIcon)
    .with('fork_knife', () => ForkKnifeIcon)
    .exhaustive();
}

const BLANK_OPTION: PickerOption = {
  key: 'blank',
  name: 'No template',
  description: 'An empty table. Build it your way.',
  icon: TableIcon,
  creation: BLANK_DATABASE,
};

/** Browses templates before creating; every new picker starts with no template selected. */
export function DatabaseTemplatePicker(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  templates: DatabaseTemplates;
  onChoose: (creation: DatabaseCreation) => void;
}) {
  const [selectedKey, setSelectedKey] = createSignal(BLANK_OPTION.key);
  let choosing = false;
  const options = (): PickerOption[] => [
    BLANK_OPTION,
    ...(props.templates.status === 'ready'
      ? props.templates.templates.map((template) => ({
          key: template.id,
          name: template.name,
          description: template.description,
          icon: templateIcon(template.icon),
          creation: templateDatabase(template),
        }))
      : []),
  ];
  const selected = () =>
    options().find((option) => option.key === selectedKey()) ?? BLANK_OPTION;
  const choose = () => {
    if (choosing) return;
    choosing = true;
    props.onChoose(selected().creation);
  };
  const navigate = (event: KeyboardEvent) => {
    const grid = event.currentTarget;
    if (
      !(grid instanceof HTMLElement) ||
      !(event.target instanceof HTMLInputElement)
    )
      return;
    const inputs = [
      ...grid.querySelectorAll<HTMLInputElement>('input[type="radio"]'),
    ];
    const index = inputs.indexOf(event.target);
    if (index < 0) return;
    const columns = Math.max(
      1,
      getComputedStyle(grid).gridTemplateColumns.split(/\s+/).filter(Boolean)
        .length
    );
    const next = match(event.key)
      .with('ArrowLeft', () => (index % columns > 0 ? index - 1 : index))
      .with('ArrowRight', () =>
        index % columns < columns - 1 && index + 1 < inputs.length
          ? index + 1
          : index
      )
      .with('ArrowUp', () => (index >= columns ? index - columns : index))
      .with('ArrowDown', () =>
        index + columns < inputs.length ? index + columns : index
      )
      .with('Home', () => 0)
      .with('End', () => inputs.length - 1)
      .otherwise(() => undefined);
    if (next === undefined) return;
    // Handle the grid before the radio input's one-dimensional navigation.
    event.preventDefault();
    event.stopPropagation();
    const input = inputs[next];
    setSelectedKey(input.value);
    input.focus({ preventScroll: true });
    input.parentElement?.scrollIntoView({
      block: 'nearest',
      inline: 'nearest',
    });
  };

  return (
    <Dialog
      open={props.open}
      onOpenChange={props.onOpenChange}
      onCloseAutoFocus={(event) => {
        if (choosing) event.preventDefault();
      }}
      position="center"
      visibleScrim
      class="w-240 max-w-[calc(100vw-2rem)]"
    >
      <Panel class="max-h-[min(48rem,calc(100dvh-4rem))]">
        <Panel.Header class="flex-col items-start gap-1 border-0 px-6 pt-6 pb-5">
          <Dialog.Title class="text-xl font-semibold text-ink">
            New database
          </Dialog.Title>
        </Panel.Header>
        <Panel.Body scroll class="px-5 pb-5 [grid-area:body]">
          <RadioGroup
            aria-label="Start from"
            value={selected().key}
            onChange={setSelectedKey}
            oncapture:keydown={navigate}
            onKeyDown={(event: KeyboardEvent) => {
              if (event.key !== 'Enter') return;
              event.preventDefault();
              choose();
            }}
            class="grid grid-cols-1 gap-4 p-1 min-[560px]:grid-cols-2 min-[880px]:grid-cols-3"
          >
            <For each={options()}>
              {(option) => (
                <RadioGroup.Item
                  value={option.key}
                  class="group relative min-w-0 flex-col items-stretch gap-0 overflow-hidden rounded-xl border border-edge bg-panel transition-colors hover:border-ink-muted data-checked:border-blue data-checked:ring-2 data-checked:ring-blue has-focus-visible:outline-2 has-focus-visible:outline-offset-3 has-focus-visible:outline-blue motion-reduce:transition-none"
                >
                  <RadioGroup.ItemInput class="sr-only" />
                  <DatabaseTemplatePreview
                    template={option.creation.template}
                  />
                  <div class="flex flex-1 flex-col gap-2 p-4">
                    <div class="flex items-center gap-2 text-ink">
                      <Dynamic
                        component={option.icon}
                        aria-hidden="true"
                        class="size-4 shrink-0 text-ink-muted"
                      />
                      <RadioGroup.ItemLabel class="text-sm font-semibold after:absolute after:inset-0">
                        {option.name}
                      </RadioGroup.ItemLabel>
                      <Show when={option.key === BLANK_OPTION.key}>
                        <span
                          aria-hidden="true"
                          class="ml-auto rounded-full bg-hover px-2 py-0.5 text-[10px] font-medium text-ink-muted"
                        >
                          Default
                        </span>
                      </Show>
                    </div>
                    <RadioGroup.ItemDescription class="text-xs leading-relaxed text-ink-muted">
                      {option.description}
                    </RadioGroup.ItemDescription>
                  </div>
                </RadioGroup.Item>
              )}
            </For>
          </RadioGroup>
          <Show when={props.templates.status !== 'ready'}>
            <p
              role="status"
              class="mt-4 flex items-center justify-center gap-1.5 text-xs text-ink-muted"
            >
              <Switch>
                <Match when={props.templates.status === 'loading'}>
                  Loading templates… You can start without one.
                </Match>
                <Match when={props.templates.status === 'failed'}>
                  Templates could not load. You can still start from scratch.
                </Match>
              </Switch>
            </p>
          </Show>
        </Panel.Body>
        <Panel.Footer class="justify-end px-6 py-4">
          <div class="ml-auto flex items-center gap-2">
            <Button
              variant="ghost"
              type="button"
              onClick={() => props.onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button variant="cta" type="button" onClick={choose}>
              {selected().creation.template
                ? 'Use template'
                : 'Create database'}
            </Button>
          </div>
        </Panel.Footer>
      </Panel>
    </Dialog>
  );
}
