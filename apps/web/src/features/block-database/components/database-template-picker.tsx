import BooksIcon from '@phosphor/books.svg';
import CalendarIcon from '@phosphor/calendar.svg';
import ConfettiIcon from '@phosphor/confetti.svg';
import KanbanIcon from '@phosphor/kanban.svg';
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
      <Panel class="max-h-[calc(100dvh-4rem)]">
        <Panel.Header class="flex-col items-start gap-1 border-0 px-6 pt-6 pb-5">
          <Dialog.Title class="text-xl font-semibold text-ink">
            New database
          </Dialog.Title>
          <Dialog.Description class="text-sm text-ink-muted">
            Start from scratch, or make it yours with a template.
          </Dialog.Description>
        </Panel.Header>
        <Panel.Body scroll class="px-5 pb-5 [grid-area:body]">
          <RadioGroup
            aria-label="Start from"
            value={selected().key}
            onChange={setSelectedKey}
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
                  class="group relative min-w-0 flex-col items-stretch gap-0 overflow-hidden rounded-xl border border-edge bg-panel transition-colors hover:border-ink-muted data-checked:border-accent data-checked:ring-1 data-checked:ring-accent has-focus-visible:outline-2 has-focus-visible:outline-offset-3 has-focus-visible:outline-accent motion-reduce:transition-none"
                >
                  <div class="absolute top-3 right-3 z-1">
                    <RadioGroup.ItemControl />
                  </div>
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
              <Match when={props.templates.status === 'ready'}>
                <SparkleIcon aria-hidden="true" class="size-3.5" />
                More templates coming soon
              </Match>
            </Switch>
          </p>
        </Panel.Body>
        <Panel.Footer class="flex-wrap justify-between gap-3 px-6 py-4">
          <p class="text-xs text-ink-muted">
            {selected().creation.template
              ? 'Includes sample records. Everything is editable.'
              : 'No sample data will be added.'}
          </p>
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
