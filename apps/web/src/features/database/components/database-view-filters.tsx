import PlusIcon from '@phosphor/plus.svg';
import XIcon from '@phosphor/x.svg';
import { Button } from '@ui/components/Button';
import { Dropdown } from '@ui/components/Dropdown';
import {
  createSignal,
  For,
  Index,
  type JSX,
  Match,
  Show,
  Switch,
} from 'solid-js';
import type {
  Conjunction,
  FilterGroup,
  FilterNode,
  FilterTest,
} from '../../../lib/core/database-sql/generated/types';
import type { DatabaseViewColumn } from '../core/database-view';
import {
  addCondition,
  addGroup,
  completeFilter,
  defaultCondition,
  type FilterPath,
  filterOperators,
  operatorChoiceOf,
  removeNode,
  setConjunction,
  updateCondition,
  withOperator,
} from '../core/view-query';
import { OptionPill } from './select-pill';
import { ViewSelect } from './view-select';

const CONJUNCTIONS: { value: Conjunction; label: string }[] = [
  { value: 'and', label: 'And' },
  { value: 'or', label: 'Or' },
];

const EMPTY: FilterGroup = { conjunction: 'and', conditions: [] };

/** How many conditions a filter tests, nested ones included. */
export function filterConditionCount(filter: FilterGroup | null | undefined) {
  return (filter?.conditions ?? []).reduce(
    (count, node): number =>
      count + (node.kind === 'condition' ? 1 : filterConditionCount(node)),
    0
  );
}

/**
 * Edits a view's filter. Conditions still being filled in stay here and are
 * left out of what the view saves; every finished change saves at once.
 */
export function FilterPanel(props: {
  columns: DatabaseViewColumn[];
  filter: FilterGroup | null | undefined;
  onChange: (filter: FilterGroup | null) => void;
}) {
  const [draft, setDraft] = createSignal(props.filter ?? EMPTY);
  const change = (next: FilterGroup) => {
    setDraft(next);
    const saved = completeFilter(next);
    if (JSON.stringify(saved) !== JSON.stringify(props.filter ?? null))
      props.onChange(saved);
  };
  return (
    <div class="w-124 max-w-full">
      <div class="flex max-h-80 flex-col gap-2 overflow-auto">
        <GroupEditor
          columns={props.columns}
          group={draft()}
          path={[]}
          onChange={change}
          root={draft()}
        />
      </div>
      <div class="mt-3 flex items-center justify-between">
        <div class="flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            disabled={!props.columns.length}
            onClick={() => change(addCondition(draft(), [], props.columns[0]))}
          >
            <PlusIcon class="size-3.5" /> Add condition
          </Button>
          <Button
            variant="ghost"
            size="sm"
            disabled={!props.columns.length}
            onClick={() => change(addGroup(draft(), [], props.columns[0]))}
          >
            <PlusIcon class="size-3.5" /> Add group
          </Button>
        </div>
        <Show when={draft().conditions.length}>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => change({ ...draft(), conditions: [] })}
          >
            Clear filters
          </Button>
        </Show>
      </div>
    </div>
  );
}

function GroupEditor(props: {
  columns: DatabaseViewColumn[];
  group: FilterGroup;
  path: FilterPath;
  root: FilterGroup;
  onChange: (root: FilterGroup) => void;
}) {
  return (
    <Index each={props.group.conditions}>
      {(node, index) => {
        const path = () => [...props.path, index];
        return (
          <div class="flex items-start gap-1.5">
            <Show
              when={index > 0}
              fallback={
                <span class="flex h-8 w-16 shrink-0 items-center px-2 text-xs text-ink-muted">
                  Where
                </span>
              }
            >
              <Show
                when={index === 1}
                fallback={
                  <span class="flex h-8 w-16 shrink-0 items-center px-2 text-xs text-ink-muted">
                    {props.group.conjunction === 'and' ? 'And' : 'Or'}
                  </span>
                }
              >
                <ViewSelect
                  label="Match conditions with"
                  value={props.group.conjunction}
                  class="w-16 shrink-0"
                  options={CONJUNCTIONS}
                  onChange={(conjunction) =>
                    props.onChange(
                      setConjunction(props.root, props.path, conjunction)
                    )
                  }
                />
              </Show>
            </Show>
            <Switch>
              <Match when={conditionOf(node())}>
                {(condition) => (
                  <ConditionEditor
                    columns={props.columns}
                    condition={condition()}
                    onChange={(next) =>
                      props.onChange(
                        updateCondition(props.root, path(), () => next)
                      )
                    }
                    onRemove={() =>
                      props.onChange(removeNode(props.root, path()))
                    }
                  />
                )}
              </Match>
              <Match when={groupOf(node())}>
                {(group) => (
                  <div
                    role="group"
                    aria-label="Filter group"
                    class="flex min-w-0 flex-1 flex-col gap-2 rounded-md border border-edge-muted p-2"
                  >
                    <GroupEditor
                      columns={props.columns}
                      group={group()}
                      path={path()}
                      root={props.root}
                      onChange={props.onChange}
                    />
                    <div class="flex items-center justify-between">
                      <Button
                        variant="ghost"
                        size="xs"
                        onClick={() =>
                          props.onChange(
                            addCondition(props.root, path(), props.columns[0])
                          )
                        }
                      >
                        <PlusIcon class="size-3" /> Add condition
                      </Button>
                      <Button
                        variant="ghost"
                        size="xs"
                        onClick={() =>
                          props.onChange(removeNode(props.root, path()))
                        }
                      >
                        Remove group
                      </Button>
                    </div>
                  </div>
                )}
              </Match>
            </Switch>
          </div>
        );
      }}
    </Index>
  );
}

type Condition = Extract<FilterNode, { kind: 'condition' }>;
type Group = Extract<FilterNode, { kind: 'group' }>;

function conditionOf(node: FilterNode): Condition | undefined {
  return node.kind === 'condition' ? node : undefined;
}

function groupOf(node: FilterNode): Group | undefined {
  return node.kind === 'group' ? node : undefined;
}

function ConditionEditor(props: {
  columns: DatabaseViewColumn[];
  condition: Condition;
  onChange: (condition: Condition) => void;
  onRemove: () => void;
}) {
  const column = () =>
    props.columns.find((item) => item.id === props.condition.column);
  const setTest = (test: FilterTest) =>
    props.onChange({ ...props.condition, test });
  return (
    <div class="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
      <ViewSelect
        label="Filter property"
        value={props.condition.column}
        class="w-28 min-w-0"
        options={props.columns.map((item) => ({
          value: item.id,
          label: item.name,
        }))}
        onChange={(value) => {
          const next = props.columns.find((item) => item.id === value);
          if (next) props.onChange(defaultCondition(next));
        }}
      />
      <Show when={column()}>
        {(current) => (
          <>
            <ViewSelect
              label="Filter condition"
              value={operatorChoiceOf(current(), props.condition.test)?.id}
              class="w-32 min-w-0"
              options={filterOperators(current()).map((choice) => ({
                value: choice.id,
                label: choice.label,
              }))}
              onChange={(value) => {
                const choice = filterOperators(current()).find(
                  (option) => option.id === value
                );
                if (choice)
                  setTest(withOperator(props.condition.test, choice.operator));
              }}
            />
            <TestValue
              column={current()}
              test={props.condition.test}
              onChange={setTest}
            />
          </>
        )}
      </Show>
      <button
        type="button"
        aria-label="Remove filter"
        class="rounded-md p-1.5 text-ink-muted hover:bg-hover focus-visible:ring-2 focus-visible:ring-ink/50"
        onClick={props.onRemove}
      >
        <XIcon class="size-3.5" />
      </button>
    </div>
  );
}

function FilterValueInput(props: JSX.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      aria-label="Filter value"
      class="h-8 min-w-28 flex-1 rounded-md border border-edge-muted bg-input px-2 text-xs outline-none placeholder:text-ink-placeholder focus:border-ink/50"
      {...props}
    />
  );
}

/** What a test compares against: text, a number, a day, or options. */
function TestValue(props: {
  column: DatabaseViewColumn;
  test: FilterTest;
  onChange: (test: FilterTest) => void;
}) {
  const text = () => (props.test.kind === 'text' ? props.test : undefined);
  const number = () => (props.test.kind === 'number' ? props.test : undefined);
  const date = () => (props.test.kind === 'date' ? props.test : undefined);
  const options = () =>
    props.test.kind === 'options' ? props.test : undefined;
  return (
    <Switch>
      <Match when={text()}>
        {(test) => (
          <FilterValueInput
            value={test().value}
            placeholder="Enter a value…"
            onInput={(event) =>
              props.onChange({ ...test(), value: event.currentTarget.value })
            }
          />
        )}
      </Match>
      <Match when={number()}>
        {(test) => (
          <FilterValueInput
            type="number"
            value={Number.isFinite(test().value) ? test().value : ''}
            placeholder="Enter a number…"
            onInput={(event) =>
              props.onChange({
                ...test(),
                value:
                  event.currentTarget.value === ''
                    ? Number.NaN
                    : Number(event.currentTarget.value),
              })
            }
          />
        )}
      </Match>
      <Match when={date()}>
        {(test) => (
          <FilterValueInput
            type="date"
            value={test().value.slice(0, 10)}
            onInput={(event) =>
              props.onChange({
                ...test(),
                value: event.currentTarget.value
                  ? `${event.currentTarget.value}T00:00:00Z`
                  : '',
              })
            }
          />
        )}
      </Match>
      <Match when={options()}>
        {(test) => (
          <Dropdown>
            <Dropdown.Trigger
              variant="ghost"
              aria-label="Filter value"
              class="h-8 min-w-28 flex-1 justify-start gap-1 rounded-md border border-edge-muted bg-input px-2 text-xs"
            >
              <Show
                when={test().options.length}
                fallback={<span class="text-ink-placeholder">Choose</span>}
              >
                <span class="flex min-w-0 flex-wrap gap-1">
                  <For
                    each={props.column.options.filter((option) =>
                      test().options.includes(option.id)
                    )}
                  >
                    {(option) => (
                      <OptionPill label={option.label} color={option.color} />
                    )}
                  </For>
                </span>
              </Show>
            </Dropdown.Trigger>
            <Dropdown.Content class="max-h-64 min-w-40 overflow-auto">
              <For each={props.column.options}>
                {(option) => (
                  <Dropdown.CheckboxItem
                    checked={test().options.includes(option.id)}
                    closeOnSelect={false}
                    onChange={(checked) =>
                      props.onChange({
                        ...test(),
                        options: checked
                          ? [...test().options, option.id]
                          : test().options.filter((id) => id !== option.id),
                      })
                    }
                  >
                    <OptionPill label={option.label} color={option.color} />
                  </Dropdown.CheckboxItem>
                )}
              </For>
            </Dropdown.Content>
          </Dropdown>
        )}
      </Match>
    </Switch>
  );
}
