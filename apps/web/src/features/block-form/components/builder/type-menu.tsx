import CaretDown from '@phosphor/caret-down.svg';
import { Dropdown } from '@ui';
import { For, type JSX, Show } from 'solid-js';
import {
  QUESTION_TYPE_CHOICES,
  type QuestionTypeChoice,
  type QuestionTypeId,
} from '../../core/question-types';
import { QuestionTypeIcon } from '../question-type-icon';

export type RelationTable = {
  databaseId: string;
  tableId: string;
  name: string;
};

/** The menu items of every question type, relation tables under their own submenu. */
function TypeItems(props: {
  current?: QuestionTypeId;
  tables: readonly RelationTable[];
  onChoose: (choice: QuestionTypeChoice, table?: RelationTable) => void;
}) {
  const group = (name: QuestionTypeChoice['group']) =>
    QUESTION_TYPE_CHOICES.filter((choice) => choice.group === name);
  const item = (choice: QuestionTypeChoice): JSX.Element =>
    choice.kind === 'pick-table' ? (
      <Dropdown.Sub>
        <Dropdown.SubTrigger disabled={props.tables.length === 0}>
          <QuestionTypeIcon type={choice.id} />
          <span class="flex-1 truncate">{choice.label}</span>
        </Dropdown.SubTrigger>
        <Dropdown.SubContent>
          <Dropdown.Group>
            <Dropdown.GroupLabel>Rows of</Dropdown.GroupLabel>
            <For each={props.tables}>
              {(table) => (
                <Dropdown.Item onSelect={() => props.onChoose(choice, table)}>
                  <span class="flex-1 truncate">{table.name}</span>
                </Dropdown.Item>
              )}
            </For>
          </Dropdown.Group>
        </Dropdown.SubContent>
      </Dropdown.Sub>
    ) : (
      <Dropdown.Item
        onSelect={() => props.onChoose(choice)}
        aria-current={props.current === choice.id ? 'true' : undefined}
        class={props.current === choice.id ? 'bg-active' : undefined}
      >
        <QuestionTypeIcon type={choice.id} />
        <span class="flex-1 truncate">{choice.label}</span>
      </Dropdown.Item>
    );
  return (
    <>
      <Dropdown.Group>
        <For each={group('forms')}>{item}</For>
      </Dropdown.Group>
      <Dropdown.Separator class="my-1 h-px bg-edge-divider" />
      <Dropdown.Group>
        <Dropdown.GroupLabel>Macro</Dropdown.GroupLabel>
        <For each={group('macro')}>{item}</For>
      </Dropdown.Group>
    </>
  );
}

/** A question's type selector. */
export function TypeMenu(props: {
  current: QuestionTypeId;
  label: string;
  tables: readonly RelationTable[];
  disabled?: boolean;
  onChoose: (choice: QuestionTypeChoice, table?: RelationTable) => void;
}) {
  return (
    <Dropdown>
      <Dropdown.Trigger
        variant="outline"
        size="sm"
        disabled={props.disabled}
        aria-label={`Question type: ${props.label}`}
        class="max-w-48 gap-1.5"
      >
        <QuestionTypeIcon type={props.current} />
        <span class="truncate">{props.label}</span>
        <CaretDown class="size-3 opacity-70" />
      </Dropdown.Trigger>
      <Dropdown.Content class="w-56">
        <TypeItems
          current={props.current}
          tables={props.tables}
          onChoose={props.onChoose}
        />
      </Dropdown.Content>
    </Dropdown>
  );
}

/** The rail's Add menu: question types, then the table's columns not on the form. */
export function AddQuestionMenu(props: {
  trigger: JSX.Element;
  tables: readonly RelationTable[];
  hiddenColumns: readonly { id: string; name: string; type: QuestionTypeId }[];
  onChoose: (choice: QuestionTypeChoice, table?: RelationTable) => void;
  onAddColumn: (columnId: string) => void;
}) {
  return (
    <Dropdown>
      <Dropdown.Trigger
        variant="outline"
        size="md"
        class="w-full justify-start gap-2"
      >
        {props.trigger}
        <CaretDown class="ml-auto size-3.5" aria-hidden="true" />
      </Dropdown.Trigger>
      <Dropdown.Content class="w-60">
        <TypeItems tables={props.tables} onChoose={props.onChoose} />
        <Show when={props.hiddenColumns.length > 0}>
          <Dropdown.Separator class="my-1 h-px bg-edge-divider" />
          <Dropdown.Group>
            <Dropdown.GroupLabel>Columns not on this form</Dropdown.GroupLabel>
            <For each={props.hiddenColumns}>
              {(column) => (
                <Dropdown.Item onSelect={() => props.onAddColumn(column.id)}>
                  <QuestionTypeIcon type={column.type} />
                  <span class="flex-1 truncate">{column.name}</span>
                </Dropdown.Item>
              )}
            </For>
          </Dropdown.Group>
        </Show>
      </Dropdown.Content>
    </Dropdown>
  );
}
