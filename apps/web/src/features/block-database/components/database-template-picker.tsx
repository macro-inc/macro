import { Listbox } from '@kobalte/core/listbox';
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
import { type Component, type ComponentProps, Match, Switch } from 'solid-js';
import { Dynamic } from 'solid-js/web';
import { match } from 'ts-pattern';
import {
  BLANK_DATABASE,
  type DatabaseCreation,
  type DatabaseTemplates,
  templateDatabase,
} from '../core/database-creation';

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
  name: 'Blank',
  description: 'Start from an empty table.',
  icon: TableIcon,
  creation: BLANK_DATABASE,
};

/** Chooses what a new database starts from: Blank, or one of the templates once they load. */
export function DatabaseTemplatePicker(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  templates: DatabaseTemplates;
  onChoose: (creation: DatabaseCreation) => void;
}) {
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
  const choose = (keys: Set<string>) => {
    const chosen = options().find((option) => keys.has(option.key));
    if (!chosen || choosing) return;
    choosing = true;
    props.onChoose(chosen.creation);
  };

  return (
    <Dialog
      open={props.open}
      onOpenChange={props.onOpenChange}
      onCloseAutoFocus={(event) => {
        if (choosing) event.preventDefault();
      }}
      visibleScrim
      class="w-108 max-w-[calc(100vw-2rem)]"
    >
      <Panel>
        <Panel.Body class="flex flex-col gap-4 p-5">
          <div class="flex flex-col gap-1">
            <Dialog.Title class="text-base font-semibold text-ink">
              New database
            </Dialog.Title>
            <Dialog.Description class="text-sm text-ink-muted">
              Start blank, or from a template with sample records.
            </Dialog.Description>
          </div>
          <Listbox<PickerOption>
            aria-label="Start from"
            options={options()}
            optionValue="key"
            optionTextValue="name"
            value={[]}
            onChange={choose}
            selectionMode="single"
            shouldFocusWrap
            // The listbox claims Escape to clear its selection, which would
            // keep the dialog from dismissing.
            onKeyDown={(event) => {
              if (event.key !== 'Escape') return;
              event.preventDefault();
              props.onOpenChange(false);
            }}
            class="flex max-h-96 flex-col gap-0.5 overflow-y-auto outline-none"
            renderItem={(item) => (
              <Listbox.Item
                item={item}
                class="flex items-start gap-3 rounded-lg px-3 py-2.5 outline-none data-highlighted:bg-hover"
              >
                <Dynamic
                  component={item.rawValue.icon}
                  class="mt-0.5 size-4 shrink-0 text-ink-muted"
                />
                <span class="flex min-w-0 flex-col gap-0.5">
                  <Listbox.ItemLabel class="text-sm font-medium text-ink">
                    {item.rawValue.name}
                  </Listbox.ItemLabel>
                  <Listbox.ItemDescription class="text-xs text-ink-muted">
                    {item.rawValue.description}
                  </Listbox.ItemDescription>
                </span>
              </Listbox.Item>
            )}
          />
          <div class="flex items-center justify-between gap-3">
            <p role="status" class="text-xs text-ink-muted">
              <Switch>
                <Match when={props.templates.status === 'loading'}>
                  Loading templates…
                </Match>
                <Match when={props.templates.status === 'failed'}>
                  Templates could not load.
                </Match>
              </Switch>
            </p>
            <Button
              variant="ghost"
              type="button"
              onClick={() => props.onOpenChange(false)}
            >
              Cancel
            </Button>
          </div>
        </Panel.Body>
      </Panel>
    </Dialog>
  );
}
