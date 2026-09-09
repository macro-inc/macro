/**
 * Prototype of Attio-style lists for the CRM, on fixtures only. Reached at
 * `/app/component/crm-lists-playground` behind the CRM feature flag.
 *
 * What it argues:
 * - A list is a collection over one parent type (companies or contacts) and
 *   its entries carry their own attributes. The same company sits in Deals
 *   and Renewals with a different stage in each, and once in Deals twice.
 * - A board is not a stage feature. `PipelineBoard` groups the entries by
 *   whichever select attribute the user picks; Renewals boards by Health as
 *   readily as by Stage. The Customers view uses the same component over
 *   companies and the Deal Stage definition.
 * - Contacts can be pipelined once they carry attributes. Candidates is a
 *   hiring pipeline over people, which nothing in the product can express
 *   today because contacts hold no properties.
 */

import { CrmStageIcon } from '@companies/crm/StageIcon';
import {
  PipelineBoard,
  type PipelineCardHandle,
  type PipelineColumn,
} from '@components/app/PipelineBoard';
import { SplitHeaderLeft } from '@components/app/split-layout/components/SplitHeader';
import { StaticSplitLabel } from '@components/app/split-layout/components/SplitLabel';
import CircleDashed from '@phosphor/circle-dashed.svg';
import { cn, Layer, SegmentedControl } from '@ui';
import { createMemo, createSignal, For, Show } from 'solid-js';
import { createStore } from 'solid-js/store';
import {
  LISTS,
  type ListAttribute,
  type ListSelectOption,
  type MockEntry,
  type MockList,
  type MockRecord,
  RECORDS,
  seedEntries,
} from './mock-lists';

/** Column key for entries with no value on the boarded attribute. */
const NOT_SET_KEY = '';

type ViewMode = 'board' | 'table';

const recordById = new Map(RECORDS.map((record) => [record.id, record]));
const listById = new Map(LISTS.map((list) => [list.id, list]));

export default function ListsPlayground() {
  const [entries, setEntries] = createStore<MockEntry[]>(seedEntries());
  const [listId, setListId] = createSignal(LISTS[0]?.id ?? 'deals');
  const [mode, setMode] = createSignal<ViewMode>('board');
  // Per-list choice of which select attribute the board groups by.
  const [boardAttributeIds, setBoardAttributeIds] = createStore<
    Record<string, string>
  >({});

  const list = () => listById.get(listId()) ?? LISTS[0];
  const selectAttributes = () =>
    list()?.attributes.filter(
      (attribute): attribute is Extract<ListAttribute, { kind: 'select' }> =>
        attribute.kind === 'select'
    ) ?? [];
  const boardAttribute = () => {
    const current = list();
    if (!current) return undefined;
    const chosen =
      boardAttributeIds[current.id] ?? current.defaultBoardAttributeId;
    return selectAttributes().find((attribute) => attribute.id === chosen);
  };

  const listEntries = createMemo(() =>
    entries.filter((entry) => entry.listId === listId())
  );

  const columns = createMemo((): PipelineColumn[] => {
    const attribute = boardAttribute();
    if (!attribute) return [];
    return [
      ...attribute.options.map((option) => ({
        key: option.id,
        label: option.label,
      })),
      { key: NOT_SET_KEY, label: 'Not set' },
    ];
  });

  const entryColumn = (entry: MockEntry) => {
    const attribute = boardAttribute();
    if (!attribute) return NOT_SET_KEY;
    const value = entry.values[attribute.id];
    return typeof value === 'string' ? value : NOT_SET_KEY;
  };

  const moveEntry = (entry: MockEntry, columnKey: string) => {
    const attribute = boardAttribute();
    if (!attribute) return;
    setEntries(
      (candidate) => candidate.id === entry.id,
      'values',
      attribute.id,
      columnKey === NOT_SET_KEY ? undefined : columnKey
    );
  };

  /** Other lists holding the same record, with that entry's stage label. */
  const membershipsElsewhere = (entry: MockEntry) =>
    entries
      .filter(
        (other) => other.recordId === entry.recordId && other.id !== entry.id
      )
      .map((other) => {
        const otherList = listById.get(other.listId);
        const stage = otherList?.attributes.find(
          (attribute) => attribute.id === otherList.defaultBoardAttributeId
        );
        const stageValue = other.values[stage?.id ?? ''];
        const label =
          stage?.kind === 'select'
            ? stage.options.find((option) => option.id === stageValue)?.label
            : undefined;
        return {
          id: other.id,
          list: otherList?.name ?? other.listId,
          sameList: other.listId === entry.listId,
          stage: label ?? 'Not set',
        };
      });

  return (
    <>
      <SplitHeaderLeft>
        <StaticSplitLabel label="CRM lists (prototype)" />
      </SplitHeaderLeft>
      <div class="flex size-full min-h-0 flex-col">
        <div class="flex flex-wrap items-center gap-3 border-b border-edge-muted px-3 py-2">
          <SegmentedControl
            size="sm"
            aria-label="List"
            value={listId()}
            options={LISTS.map((item) => ({
              value: item.id,
              label: item.name,
            }))}
            onChange={setListId}
          />
          <span class="min-w-0 truncate text-xs text-ink-muted">
            {list()?.description}{' '}
            <span class="text-ink-extra-muted">
              ({list()?.parentType === 'contact' ? 'people' : 'companies'})
            </span>
          </span>
          <div class="ml-auto flex items-center gap-3">
            <Show when={mode() === 'board' && selectAttributes().length > 1}>
              <label class="flex items-center gap-1.5 text-xs text-ink-muted">
                Board by
                <SegmentedControl
                  size="sm"
                  aria-label="Board by"
                  value={boardAttribute()?.id ?? ''}
                  options={selectAttributes().map((attribute) => ({
                    value: attribute.id,
                    label: attribute.label,
                  }))}
                  onChange={(id) => {
                    const current = list();
                    if (current) setBoardAttributeIds(current.id, id);
                  }}
                />
              </label>
            </Show>
            <SegmentedControl
              size="sm"
              aria-label="View"
              value={mode()}
              options={[
                { value: 'board', label: 'Board' },
                { value: 'table', label: 'Table' },
              ]}
              onChange={setMode}
            />
          </div>
        </div>
        <div class="min-h-0 flex-1">
          <Show when={list()}>
            {(current) => (
              <Show
                when={mode() === 'board'}
                fallback={
                  <EntryTable
                    list={current()}
                    entries={listEntries()}
                    membershipsElsewhere={membershipsElsewhere}
                  />
                }
              >
                <PipelineBoard
                  columns={columns()}
                  items={listEntries()}
                  itemKey={(entry) => entry.id}
                  itemColumn={entryColumn}
                  emptyKey={NOT_SET_KEY}
                  onMove={moveEntry}
                  columnIcon={(column, index) => (
                    <Show
                      when={column.key !== NOT_SET_KEY}
                      fallback={
                        <CircleDashed class="size-3.5 text-ink-extra-muted" />
                      }
                    >
                      <CrmStageIcon
                        optionId={column.key}
                        index={index}
                        class="size-3.5"
                      />
                    </Show>
                  )}
                  card={(entry, handle) => (
                    <EntryCard
                      list={current()}
                      entry={entry}
                      record={recordById.get(entry.recordId)}
                      hiddenAttributeId={boardAttribute()?.id}
                      elsewhere={membershipsElsewhere(entry)}
                      handle={handle}
                    />
                  )}
                />
              </Show>
            )}
          </Show>
        </div>
      </div>
    </>
  );
}

type Membership = {
  id: string;
  list: string;
  sameList: boolean;
  stage: string;
};

function EntryCard(props: {
  list: MockList;
  entry: MockEntry;
  record: MockRecord | undefined;
  /** The boarded attribute; the column already shows it. */
  hiddenAttributeId: string | undefined;
  elsewhere: Membership[];
  handle: PipelineCardHandle;
}) {
  const shownAttributes = () =>
    props.list.attributes.filter(
      (attribute) =>
        attribute.id !== props.hiddenAttributeId &&
        props.entry.values[attribute.id] !== undefined
    );

  return (
    <Layer depth={2}>
      <div
        draggable={props.handle.draggable}
        onDragStart={props.handle.onDragStart}
        onDragEnd={props.handle.onDragEnd}
        class={cn(
          'flex flex-col gap-1.5 rounded-lg border border-edge-muted bg-panel p-2.5 text-sm',
          'hover:border-edge hover:bg-active transition-colors',
          props.handle.dragging && 'opacity-40'
        )}
      >
        <div class="flex min-w-0 items-center gap-2">
          <RecordGlyph record={props.record} />
          <span class="min-w-0 truncate font-semibold">
            {props.record?.name ?? props.entry.recordId}
          </span>
        </div>
        <Show when={props.record?.detail}>
          {(detail) => (
            <span class="truncate text-xs text-ink-extra-muted">
              {detail()}
            </span>
          )}
        </Show>
        <Show when={shownAttributes().length > 0}>
          <dl class="grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5 text-xs">
            <For each={shownAttributes()}>
              {(attribute) => (
                <>
                  <dt class="text-ink-extra-muted">{attribute.label}</dt>
                  <dd class="min-w-0 truncate text-ink-muted">
                    <AttributeValue
                      attribute={attribute}
                      value={props.entry.values[attribute.id]}
                    />
                  </dd>
                </>
              )}
            </For>
          </dl>
        </Show>
        <Show when={props.elsewhere.length > 0}>
          <div class="flex flex-wrap gap-1 pt-0.5">
            <For each={props.elsewhere}>
              {(membership) => (
                <span
                  class="rounded-sm border border-edge-muted px-1 py-px text-[11px] leading-4 text-ink-extra-muted"
                  title={
                    membership.sameList
                      ? `Another ${props.list.name} entry for this record`
                      : `Also in ${membership.list}`
                  }
                >
                  {membership.sameList ? 'Also here' : membership.list}:{' '}
                  {membership.stage}
                </span>
              )}
            </For>
          </div>
        </Show>
      </div>
    </Layer>
  );
}

function EntryTable(props: {
  list: MockList;
  entries: MockEntry[];
  membershipsElsewhere: (entry: MockEntry) => Membership[];
}) {
  return (
    <div class="size-full overflow-auto">
      <table class="w-full border-collapse text-sm">
        <thead class="sticky top-0 bg-surface text-left text-xs font-semibold text-ink-muted">
          <tr>
            <th class="border-b border-edge-muted px-3 py-2">
              {props.list.parentType === 'contact' ? 'Person' : 'Company'}
            </th>
            <For each={props.list.attributes}>
              {(attribute) => (
                <th class="border-b border-edge-muted px-3 py-2">
                  {attribute.label}
                </th>
              )}
            </For>
            <th class="border-b border-edge-muted px-3 py-2">Also in</th>
          </tr>
        </thead>
        <tbody>
          <For each={props.entries}>
            {(entry) => {
              const record = recordById.get(entry.recordId);
              return (
                <tr class="hover:bg-active">
                  <td class="border-b border-edge-muted px-3 py-2">
                    <div class="flex min-w-0 items-center gap-2">
                      <RecordGlyph record={record} />
                      <span class="truncate font-medium">
                        {record?.name ?? entry.recordId}
                      </span>
                      <span class="truncate text-xs text-ink-extra-muted">
                        {record?.detail}
                      </span>
                    </div>
                  </td>
                  <For each={props.list.attributes}>
                    {(attribute) => (
                      <td class="border-b border-edge-muted px-3 py-2 text-ink-muted">
                        <AttributeValue
                          attribute={attribute}
                          value={entry.values[attribute.id]}
                        />
                      </td>
                    )}
                  </For>
                  <td class="border-b border-edge-muted px-3 py-2 text-xs text-ink-extra-muted">
                    {props
                      .membershipsElsewhere(entry)
                      .map((membership) =>
                        membership.sameList
                          ? `Also here (${membership.stage})`
                          : `${membership.list} (${membership.stage})`
                      )
                      .join(', ')}
                  </td>
                </tr>
              );
            }}
          </For>
        </tbody>
      </table>
    </div>
  );
}

function AttributeValue(props: {
  attribute: ListAttribute;
  value: string | number | undefined;
}) {
  const option = (): ListSelectOption | undefined =>
    props.attribute.kind === 'select'
      ? props.attribute.options.find((entry) => entry.id === props.value)
      : undefined;

  return (
    <Show
      when={props.value !== undefined}
      fallback={<span class="text-ink-extra-muted">Not set</span>}
    >
      <Show
        when={props.attribute.kind === 'select'}
        fallback={<span>{formatValue(props.attribute, props.value)}</span>}
      >
        <span class="inline-flex items-center gap-1">
          <CrmStageIcon optionId={String(props.value)} class="size-3" />
          {option()?.label ?? String(props.value)}
        </span>
      </Show>
    </Show>
  );
}

function formatValue(
  attribute: ListAttribute,
  value: string | number | undefined
): string {
  if (value === undefined) return '';
  if (attribute.kind === 'currency' && typeof value === 'number') {
    return value.toLocaleString(undefined, {
      style: 'currency',
      currency: 'USD',
      maximumFractionDigits: 0,
    });
  }
  return String(value);
}

/** Square initial for a company, round initials for a person. */
function RecordGlyph(props: { record: MockRecord | undefined }) {
  const initials = () => {
    const name = props.record?.name ?? '?';
    const parts = name.split(' ');
    return props.record?.type === 'contact' && parts.length > 1
      ? `${parts[0]?.[0] ?? ''}${parts[1]?.[0] ?? ''}`
      : (name[0] ?? '?');
  };
  return (
    <span
      class={cn(
        'flex size-4 shrink-0 items-center justify-center bg-accent/15 text-[9px] font-semibold uppercase text-accent',
        props.record?.type === 'contact' ? 'rounded-full' : 'rounded-sm'
      )}
      aria-hidden="true"
    >
      {initials()}
    </span>
  );
}
