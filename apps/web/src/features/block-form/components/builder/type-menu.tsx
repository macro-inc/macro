import CaretDown from '@phosphor/caret-down.svg';
import CaretRight from '@phosphor/caret-right.svg';
import Check from '@phosphor/check.svg';
import Plus from '@phosphor/plus.svg';
import { Dropdown } from '@ui';
import { For, type JSX, Show } from 'solid-js';
import {
  QUESTION_TYPE_CHOICES,
  QUESTION_TYPE_GROUPS,
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
  const item = (choice: QuestionTypeChoice): JSX.Element =>
    choice.kind === 'pick-table' ? (
      <Dropdown.Sub>
        <Dropdown.SubTrigger
          disabled={props.tables.length === 0}
          aria-current={props.current === choice.id ? 'true' : undefined}
          class={props.current === choice.id ? 'bg-active' : undefined}
        >
          <QuestionTypeIcon type={choice.id} />
          <span class="flex-1 truncate">{choice.label}</span>
          <CaretRight class="size-3.5" aria-hidden="true" />
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
        <Show when={props.current === choice.id}>
          <Check class="size-3.5" aria-hidden="true" />
        </Show>
      </Dropdown.Item>
    );
  return (
    <For each={QUESTION_TYPE_GROUPS}>
      {(group) => (
        <Dropdown.Group>
          <Dropdown.GroupLabel>{group.label}</Dropdown.GroupLabel>
          <For
            each={QUESTION_TYPE_CHOICES.filter(
              (choice) => choice.group === group.id
            )}
          >
            {item}
          </For>
        </Dropdown.Group>
      )}
    </For>
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
      <Dropdown.Content class="max-h-[min(32rem,75vh)] w-64 overflow-y-auto">
        <TypeItems
          current={props.current}
          tables={props.tables}
          onChoose={props.onChoose}
        />
      </Dropdown.Content>
    </Dropdown>
  );
}

/** Add a new question or reuse a field from the associated database. */
export function AddQuestionMenu(props: {
  trigger: JSX.Element;
  disabled?: boolean;
  children?: JSX.Element;
  tables: readonly RelationTable[];
  hiddenColumns: readonly { id: string; name: string; type: QuestionTypeId }[];
  onChoose: (choice: QuestionTypeChoice, table?: RelationTable) => void;
  onAddColumn: (columnId: string) => void;
  onAddAllColumns?: () => void;
}) {
  return (
    <Dropdown>
      <Dropdown.Trigger
        variant="outline"
        size="md"
        class="w-full justify-start gap-2"
        disabled={props.disabled}
      >
        {props.trigger}
        <CaretDown class="ml-auto size-3.5" aria-hidden="true" />
      </Dropdown.Trigger>
      <Dropdown.Content class="max-h-[min(32rem,75vh)] w-64 overflow-y-auto">
        <TypeItems tables={props.tables} onChoose={props.onChoose} />
        <Show when={props.hiddenColumns.length > 0}>
          <Dropdown.Separator class="my-1 h-px bg-edge-divider" />
          <Dropdown.Group>
            <Dropdown.GroupLabel>From database</Dropdown.GroupLabel>
            <Show when={props.onAddAllColumns}>
              {(addAll) => (
                <Dropdown.Item onSelect={() => addAll()()}>
                  <Plus class="size-4" />
                  Add all {props.hiddenColumns.length} columns
                </Dropdown.Item>
              )}
            </Show>
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
        {props.children}
      </Dropdown.Content>
    </Dropdown>
  );
}
