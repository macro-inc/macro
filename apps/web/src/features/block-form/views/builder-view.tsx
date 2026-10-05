import ArrowSquareOut from '@phosphor/arrow-square-out.svg';
import Database from '@phosphor/database.svg';
import Plus from '@phosphor/plus.svg';
import Rows from '@phosphor/rows.svg';
import ShieldCheck from '@phosphor/shield-check.svg';
import Warning from '@phosphor/warning.svg';
import { Button, Dropdown } from '@ui';
import {
  createMemo,
  createSignal,
  createUniqueId,
  For,
  Match,
  Show,
  Switch,
  untrack,
} from 'solid-js';
import { v7 as uuidv7 } from 'uuid';
import {
  BuilderRail,
  ConversionNotice,
  DropIndicator,
  HiddenColumns,
  OutlineSection,
  SaveIndicator,
  TitleCard,
} from '../components/builder/builder-chrome';
import {
  DragHandle,
  DragInstructions,
} from '../components/builder/drag-handle';
import { OptionListEditor } from '../components/builder/option-list-editor';
import { QuestionPreview } from '../components/builder/question-body';
import { QuestionFooter } from '../components/builder/question-footer';
import { QuestionRow } from '../components/builder/question-row';
import {
  GateCard,
  RoutingFooter,
  SectionCard,
  SectionMenu,
} from '../components/builder/section-card';
import {
  AddQuestionMenu,
  type RelationTable,
  TypeMenu,
} from '../components/builder/type-menu';
import { QuestionTypeIcon } from '../components/question-type-icon';
import { type FormDetailSource, useFormContext } from '../context/form-context';
import type { Box, MeasuredSection } from '../core/drop-target';
import { placementOf, stepPlacement } from '../core/drop-target';
import {
  brokenGateColumns,
  gateColumns,
  questionNumbers,
} from '../core/form-layout';
import type { FormColumn, FormDetail, FormSection } from '../core/form-model';
import {
  placementDescription,
  routingLine,
  sectionName,
  sectionPosition,
} from '../core/layout-messages';
import {
  hasOptions,
  questionTypeLabel,
  questionTypeOf,
} from '../core/question-types';
import { rulesSentence } from '../core/rule-sentence';
import { createBuilder } from '../primitives/create-builder';
import {
  createBuilderDrag,
  type DragTarget,
} from '../primitives/create-builder-drag';

const LAYOUT_SAVE_DELAY_MS = 400;

function boxOf(element: Element): Box {
  const { top, bottom, left, right } = element.getBoundingClientRect();
  return { top, bottom, left, right };
}

/**
 * The Build tab (RFC 02 §3): sections and questions on a centered column,
 * the rail beside it. Column facts go to the database's ops, presentation to
 * the form's layout.
 */
export function BuilderView(props: {
  source: FormDetailSource;
  detail: FormDetail;
  onOpenResponses: () => void;
  onOpenDatabase: (databaseId: string) => void;
}) {
  const context = useFormContext();
  const form = () => props.detail.form;
  const table = context.createTableSource(
    () => props.detail.form.databaseId,
    () => props.detail.form.tableId
  );
  context.followTable(
    () => props.detail.form.databaseId,
    () => void props.source.refetch()
  );
  const summary = context.responses.createSummary(
    () => props.detail.form.id,
    () => props.detail.access !== 'view'
  );
  const columnWrites = createMemo(() =>
    context.columns(props.detail.form.databaseId, props.detail.form.tableId)
  );
  const builder = createBuilder({
    detail: props.source.detail,
    // Column facts come from both reads, so the builder's read-back takes both.
    refetch: async () => {
      await Promise.all([props.source.refetch(), table.refetch()]);
    },
    tableColumns: table.columns,
    saveLayout: (layout) => context.saveLayout(props.detail.form.id, layout),
    columnWrites,
    notify: context.notify,
    mintId: uuidv7,
    delayMs: LAYOUT_SAVE_DELAY_MS,
  });
  const [editingRules, setEditingRules] = createSignal<string>();
  // One per mount: the same form can be built in two splits.
  const instructionsId = createUniqueId();
  let viewport: HTMLDivElement | undefined;
  let column: HTMLDivElement | undefined;

  const layout = () => builder.layout() ?? props.detail.layout;
  const sectionIds = () => layout().sections.map((section) => section.id);
  const sectionById = (sectionId: string) =>
    layout().sections.find((section) => section.id === sectionId);
  const questionSections = () =>
    layout().sections.filter((section) => section.kind === 'questions');
  const numbers = createMemo(() => questionNumbers(layout()));
  const relationTables = (): RelationTable[] =>
    table.tables().map((entry) => ({
      databaseId: props.detail.form.databaseId,
      tableId: entry.id,
      name: entry.name,
    }));
  const columnTitle = (columnId: string) =>
    builder.column(columnId)?.name ?? 'Untitled question';
  const questionTitle = (questionId: string) => {
    const placement = placementOf(layout(), questionId);
    const question = placement
      ? sectionById(placement.sectionId)?.questions.find(
          (item) => item.id === questionId
        )
      : undefined;
    return question ? columnTitle(question.columnId) : 'question';
  };

  function measureQuestions(): MeasuredSection[] {
    if (!viewport) return [];
    return [
      ...viewport.querySelectorAll<HTMLElement>('[data-form-section]'),
    ].map((section) => {
      const id = section.dataset.formSection ?? '';
      const list = section.querySelector(`[data-form-section-list="${id}"]`);
      return {
        id,
        kind: section.dataset.sectionKind === 'gate' ? 'gate' : 'questions',
        box: boxOf(section),
        list: boxOf(list ?? section),
        questions: [
          ...(list?.querySelectorAll<HTMLElement>('[data-form-question]') ??
            []),
        ].map((question) => ({
          id: question.dataset.formQuestion ?? '',
          box: boxOf(question),
        })),
      };
    });
  }

  const describe = (target: DragTarget) =>
    target.kind === 'question'
      ? `question “${questionTitle(target.id)}”`
      : `“${sectionName(layout(), target.id)}”`;

  /** Focus a question's or section's drag handle, wherever it now renders. */
  const focusHandle = (target: { kind: 'question' | 'section'; id: string }) =>
    viewport
      ?.querySelector<HTMLElement>(
        `[data-drag-handle="${target.kind}:${target.id}"]`
      )
      ?.focus({ preventScroll: false });

  const drag = createBuilderDrag({
    layout,
    viewport: () => viewport,
    measureQuestions,
    measureSections: () =>
      measureQuestions().map(({ id, box }) => ({ id, box })),
    refusalForQuestion: builder.questionMoveRefusal,
    refusalForSection: builder.sectionMoveRefusal,
    dropQuestion: (questionId, placement) => {
      builder.moveQuestion(questionId, placement);
      builder.select(questionId);
    },
    dropSection: builder.moveSection,
    describe,
    describePlacement: (questionId, placement) =>
      placementDescription(layout(), questionId, placement),
    focusHandle,
  });

  const indicatorTop = () => {
    const lineY = drag.session()?.lineY;
    if (lineY === undefined || !column) return undefined;
    return lineY - column.getBoundingClientRect().top;
  };

  const moveByStep = (questionId: string, direction: 'up' | 'down') => {
    const from = placementOf(layout(), questionId);
    const to = from && stepPlacement(layout(), questionId, from, direction);
    if (!to) return;
    if (!builder.moveQuestion(questionId, to)) return;
    drag.refocus({ kind: 'question', id: questionId });
  };

  const moveToSection = (questionId: string, sectionId: string) => {
    const target = sectionById(sectionId);
    if (!target) return;
    builder.moveQuestion(questionId, {
      sectionId,
      index: target.questions.length,
    });
  };

  async function confirmDeleteColumn(questionId: string, columnId: string) {
    const name = columnTitle(columnId);
    const rows = summary.value()?.rows;
    const confirmed = await context.confirm({
      title: `Delete the column “${name}”?`,
      body: `This deletes the column from ${table.tableName() ?? 'the table'} with every answer in it${rows !== undefined ? ` (${rows === 1 ? '1 row' : `${rows} rows`})` : ''}. To keep the answers, remove the question from the form instead.`,
      confirmLabel: 'Delete column',
      tone: 'danger',
    });
    if (confirmed) await builder.deleteColumn(questionId);
  }

  async function confirmRemoveSection(section: FormSection) {
    if (section.kind === 'questions' && section.questions.length > 0) {
      const confirmed = await context.confirm({
        title: `Delete “${sectionName(layout(), section.id)}”?`,
        body: `Its ${section.questions.length === 1 ? 'question leaves' : `${section.questions.length} questions leave`} the form. The columns and their answers stay in the table.`,
        confirmLabel: 'Delete section',
        tone: 'danger',
      });
      if (!confirmed) return;
    }
    builder.removeSection(section.id);
  }

  const gateCount = () =>
    layout().sections.filter((section) => section.kind === 'gate').length;

  const hiddenColumnRows = () =>
    builder.hiddenColumns().map((hidden) => ({
      id: hidden.id,
      name: hidden.name,
      type: questionTypeOf(hidden.kind, null),
      label: questionTypeLabel(hidden.kind, null),
    }));

  const addAllHidden = () => {
    for (const hidden of builder.hiddenColumns())
      builder.addExistingColumn(hidden.id);
  };

  return (
    <div
      ref={viewport}
      class="@container/builder relative h-full min-h-0 overflow-y-auto bg-canvas-base touch:pb-(--mobile-content-inset-bottom)"
    >
      <DragInstructions id={instructionsId} />
      <div aria-live="assertive" aria-atomic="true" class="sr-only">
        {drag.announcement()}
      </div>
      <div class="mx-auto flex w-full max-w-[1040px] flex-col gap-6 px-4 py-6 @4xl/builder:flex-row @4xl/builder:items-start @4xl/builder:px-8">
        <div class="mx-auto flex w-full max-w-[680px] min-w-0 flex-col gap-4">
          <div class="flex items-center justify-end">
            <SaveIndicator state={builder.saveState()} />
          </div>
          <Show when={props.detail.tableGone}>
            <div
              role="alert"
              class="flex items-start gap-2 rounded-lg border border-failure bg-failure-bg px-3 py-2.5 text-sm text-failure-ink"
            >
              <Warning class="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              This form’s table was deleted or its database is in the trash. It
              can’t take responses until the database is restored.
            </div>
          </Show>
          <TitleCard
            name={form().name}
            description={form().description}
            onName={(name) =>
              context.renameForm(form().id, name).match(
                () => true,
                (failure) => {
                  context.notify.failure(
                    `The form couldn’t be renamed: ${failure.message}`
                  );
                  return false;
                }
              )
            }
            onDescription={(description) =>
              context.updateMetadata(form().id, { description }).match(
                () => true,
                (failure) => {
                  context.notify.failure(
                    `The description wasn’t saved: ${failure.message}`
                  );
                  return false;
                }
              )
            }
            meta={
              <>
                <li>
                  <button
                    type="button"
                    class="inline-flex items-center gap-1 rounded text-ink-muted outline-none hover:text-ink hover:underline focus-visible:ring-2 focus-visible:ring-edge-focus"
                    onClick={props.onOpenResponses}
                  >
                    <Database class="size-3.5" aria-hidden="true" />
                    {table.databaseName()
                      ? `Responses in database “${table.databaseName()}”`
                      : 'Responses in its database'}
                  </button>
                </li>
                <li>
                  {form().audience === 'public'
                    ? 'Anyone with the link'
                    : 'Workspace members'}
                </li>
                <li>
                  {questionSections().length === 1
                    ? '1 section'
                    : `${questionSections().length} sections`}
                </li>
                <Show when={gateCount() > 0}>
                  <li>
                    {gateCount() === 1 ? '1 gate' : `${gateCount()} gates`}
                  </li>
                </Show>
              </>
            }
          />
          <Show when={builder.conversion()}>
            {(pending) => (
              <ConversionNotice
                message={pending().message}
                label={pending().label}
                onConvert={() => void builder.convertQuestion()}
                onDismiss={builder.dismissConversion}
              />
            )}
          </Show>
          <div ref={column} class="relative flex flex-col gap-4">
            <For each={sectionIds()}>
              {(sectionId) => {
                const section = () => sectionById(sectionId);
                const index = () =>
                  layout().sections.findIndex((item) => item.id === sectionId);
                const sectionTarget: DragTarget = {
                  kind: 'section',
                  id: sectionId,
                };
                const handle = () => (
                  <DragHandle
                    instructionsId={instructionsId}
                    data-drag-handle={`section:${sectionId}`}
                    label={`Move ${sectionName(layout(), sectionId)}`}
                    dragging={drag.isDragging(sectionTarget)}
                    disabled={props.detail.tableGone}
                    handle={drag.handleProps(() => sectionTarget)}
                  />
                );
                const menu = () => (
                  <SectionMenu
                    label={`${sectionName(layout(), sectionId)} actions`}
                    canMoveUp={
                      index() > 0 &&
                      !builder.sectionMoveRefusal(sectionId, index() - 1)
                    }
                    canMoveDown={
                      index() < layout().sections.length - 1 &&
                      !builder.sectionMoveRefusal(sectionId, index() + 1)
                    }
                    deleteLabel={
                      section()?.kind === 'gate'
                        ? 'Delete gate'
                        : 'Delete section'
                    }
                    onMoveUp={() => builder.moveSection(sectionId, index() - 1)}
                    onMoveDown={() =>
                      builder.moveSection(sectionId, index() + 1)
                    }
                    onDelete={() => {
                      const current = section();
                      if (current) void confirmRemoveSection(current);
                    }}
                  />
                );
                return (
                  <Show when={section()}>
                    {(current) => (
                      <Switch>
                        <Match when={current().kind === 'gate'}>
                          <GateCard
                            sectionId={sectionId}
                            eyebrow={`Gate ${sectionPosition(layout(), sectionId)}`}
                            title={current().title}
                            sentence={rulesSentence(
                              current().gateRules,
                              builder.columns()
                            )}
                            message={current().gateMessage}
                            dragging={drag.isDragging(sectionTarget)}
                            editingRules={editingRules() === sectionId}
                            brokenRules={
                              brokenGateColumns(layout(), sectionId).length
                            }
                            onRepair={() => builder.repairGate(sectionId)}
                            handle={handle()}
                            menu={menu()}
                            noQuestionsBefore={
                              gateColumns(layout(), sectionId).length === 0
                            }
                            onEditRules={() => setEditingRules(sectionId)}
                            onTitle={(title) =>
                              builder.updateSection(sectionId, { title })
                            }
                            onMessage={(gateMessage) =>
                              builder.updateSection(sectionId, { gateMessage })
                            }
                            ruleEditor={
                              <div class="flex flex-col gap-2 rounded-lg border border-edge-muted bg-surface p-3">
                                {
                                  // Rendered once per opening, its props read
                                  // live: a save must not remount the editor
                                  // and drop a condition still being filled.
                                  untrack(() =>
                                    context.ui.renderConditionEditor({
                                      get columns() {
                                        return gateColumns(
                                          layout(),
                                          sectionId
                                        ).flatMap((columnId): FormColumn[] => {
                                          const found =
                                            builder.column(columnId);
                                          return found ? [found] : [];
                                        });
                                      },
                                      get rules() {
                                        return current().gateRules;
                                      },
                                      onChange: (gateRules) =>
                                        builder.updateSection(sectionId, {
                                          gateRules: gateRules ?? {
                                            conjunction: 'and',
                                            conditions: [],
                                          },
                                        }),
                                    })
                                  )
                                }
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  class="self-end"
                                  onClick={() => setEditingRules(undefined)}
                                >
                                  Done
                                </Button>
                              </div>
                            }
                          />
                        </Match>
                        <Match when={current().kind === 'questions'}>
                          <SectionCard
                            sectionId={sectionId}
                            eyebrow={`Section ${sectionPosition(layout(), sectionId)} of ${questionSections().length}`}
                            title={current().title}
                            description={current().description}
                            questionCount={current().questions.length}
                            empty={current().questions.length === 0}
                            dragging={drag.isDragging(sectionTarget)}
                            targeted={builder.targetSectionId() === sectionId}
                            onTarget={() => builder.focusSection(sectionId)}
                            addQuestion={
                              <AddQuestionMenu
                                trigger={
                                  <>
                                    <Plus class="size-3.5" />
                                    Add question
                                  </>
                                }
                                tables={relationTables()}
                                hiddenColumns={hiddenColumnRows()}
                                onChoose={(choice, relation) =>
                                  void builder.addQuestion(choice, relation, {
                                    sectionId,
                                    index: 0,
                                  })
                                }
                                onAddColumn={(columnId) =>
                                  builder.addExistingColumn(columnId, {
                                    sectionId,
                                    index: 0,
                                  })
                                }
                              />
                            }
                            handle={handle()}
                            menu={menu()}
                            onTitle={(title) =>
                              builder.updateSection(sectionId, { title })
                            }
                            onDescription={(description) =>
                              builder.updateSection(sectionId, { description })
                            }
                            routing={
                              <RoutingFooter
                                after={`section ${sectionPosition(layout(), sectionId)}`}
                                next={routingLine(layout(), sectionId)}
                              />
                            }
                          >
                            <For
                              each={current().questions.map(
                                (question) => question.id
                              )}
                            >
                              {(questionId) => (
                                <QuestionItem
                                  questionId={questionId}
                                  sectionId={sectionId}
                                />
                              )}
                            </For>
                          </SectionCard>
                        </Match>
                      </Switch>
                    )}
                  </Show>
                );
              }}
            </For>
            <Show when={indicatorTop() !== undefined}>
              <DropIndicator
                top={indicatorTop() ?? 0}
                refusal={drag.session()?.refusal}
              />
            </Show>
          </div>
          <HiddenColumns
            columns={hiddenColumnRows()}
            onAdd={(columnId) => builder.addExistingColumn(columnId)}
          />
        </div>
        <BuilderRail
          add={
            <div class="flex flex-col gap-1.5">
              <AddQuestionMenu
                trigger={
                  <>
                    <Plus class="size-3.5" />
                    Question
                  </>
                }
                tables={relationTables()}
                hiddenColumns={hiddenColumnRows()}
                onChoose={(choice, relation) =>
                  void builder.addQuestion(choice, relation)
                }
                onAddColumn={(columnId) => builder.addExistingColumn(columnId)}
              />
              <Button
                variant="outline"
                size="sm"
                class="w-full justify-start gap-2"
                onClick={() => builder.addSection('questions')}
              >
                <Rows class="size-3.5" />
                Section
              </Button>
              <Button
                variant="outline"
                size="sm"
                class="w-full justify-start gap-2"
                onClick={() => {
                  const id = builder.addSection('gate');
                  if (id) setEditingRules(id);
                }}
              >
                <ShieldCheck class="size-3.5" />
                Gate section
              </Button>
              <Dropdown>
                <Dropdown.Trigger
                  variant="outline"
                  size="sm"
                  class="w-full justify-start gap-2"
                  disabled={hiddenColumnRows().length === 0}
                >
                  <Database class="size-3.5" />
                  Questions from the table
                </Dropdown.Trigger>
                <Dropdown.Content class="w-60">
                  <Dropdown.Item onSelect={addAllHidden}>
                    <Plus class="size-4" />
                    <span class="flex-1">
                      Add all {hiddenColumnRows().length} columns
                    </span>
                  </Dropdown.Item>
                  <Dropdown.Separator class="my-1 h-px bg-edge-divider" />
                  <For each={hiddenColumnRows()}>
                    {(hidden) => (
                      <Dropdown.Item
                        onSelect={() => builder.addExistingColumn(hidden.id)}
                      >
                        <QuestionTypeIcon type={hidden.type} />
                        <span class="flex-1 truncate">{hidden.name}</span>
                      </Dropdown.Item>
                    )}
                  </For>
                </Dropdown.Content>
              </Dropdown>
            </div>
          }
          outline={
            <ul class="flex flex-col gap-2">
              <For each={layout().sections}>
                {(section) => (
                  <OutlineSection
                    name={sectionName(layout(), section.id)}
                    gate={section.kind === 'gate'}
                    questions={section.questions.map((question) => ({
                      id: question.id,
                      title: columnTitle(question.columnId),
                      selected: builder.selectedId() === question.id,
                    }))}
                    onSelectQuestion={(questionId) => {
                      builder.select(questionId);
                      viewport
                        ?.querySelector(`[data-form-question="${questionId}"]`)
                        ?.scrollIntoView({
                          block: 'center',
                          behavior: 'smooth',
                        });
                    }}
                  />
                )}
              </For>
            </ul>
          }
          storesTo={
            <div class="flex flex-col gap-2">
              <button
                type="button"
                class="flex items-center gap-2 rounded-lg border border-edge-muted bg-surface px-2.5 py-2 text-left outline-none hover:bg-hover focus-visible:ring-2 focus-visible:ring-edge-focus"
                onClick={() => props.onOpenDatabase(form().databaseId)}
              >
                <Database
                  class="size-4 shrink-0 text-code"
                  aria-hidden="true"
                />
                <span class="min-w-0 flex-1">
                  <span class="block truncate text-sm text-ink">
                    {table.databaseName() ?? 'Database'}
                  </span>
                  <span class="block truncate text-xs text-ink-muted">
                    {table.tableName() ?? 'Responses'}
                  </span>
                </span>
                <ArrowSquareOut
                  class="size-3.5 text-ink-muted"
                  aria-hidden="true"
                />
              </button>
              <p class="text-xs leading-relaxed text-ink-muted">
                Every question is a column. Adding a question adds a column.
                Removing a question keeps the column.
              </p>
            </div>
          }
        />
      </div>
    </div>
  );

  function QuestionItem(itemProps: { questionId: string; sectionId: string }) {
    const question = () =>
      sectionById(itemProps.sectionId)?.questions.find(
        (item) => item.id === itemProps.questionId
      );
    const target: DragTarget = { kind: 'question', id: itemProps.questionId };
    return (
      <Show when={question()}>
        {(current) => {
          const columnOf = () => builder.column(current().columnId);
          return (
            <Show
              when={columnOf()}
              fallback={
                <div class="px-4 py-3 text-xs text-ink-muted">
                  This question’s column is gone. It leaves the form when the
                  layout saves.
                </div>
              }
            >
              {(columnFacts) => {
                const typeId = () =>
                  questionTypeOf(columnFacts().kind, current().widget);
                const typeLabel = () =>
                  questionTypeLabel(columnFacts().kind, current().widget);
                const selected = () => builder.selectedId() === current().id;
                const relationName = () => {
                  const kind = columnFacts().kind;
                  return kind.type === 'relation'
                    ? table.tables().find((entry) => entry.id === kind.table)
                        ?.name
                    : undefined;
                };
                const placement = () => placementOf(layout(), current().id);
                const canStep = (direction: 'up' | 'down') => {
                  const from = placement();
                  const to =
                    from &&
                    stepPlacement(layout(), current().id, from, direction);
                  return !!to && !builder.questionMoveRefusal(current().id, to);
                };
                return (
                  <QuestionRow
                    questionId={current().id}
                    number={numbers().get(current().id) ?? 0}
                    title={columnFacts().name}
                    helpText={current().helpText}
                    required={current().required}
                    selected={selected()}
                    dragging={drag.isDragging(target)}
                    busy={builder.isColumnBusy(columnFacts().id)}
                    onSelect={() => builder.select(current().id)}
                    onRename={(name) =>
                      void builder.renameQuestion(current().id, name)
                    }
                    onHelpText={(helpText) =>
                      builder.updateQuestion(current().id, { helpText })
                    }
                    handle={
                      <DragHandle
                        instructionsId={instructionsId}
                        data-drag-handle={`question:${current().id}`}
                        label={`Move question “${columnFacts().name}”`}
                        dragging={drag.isDragging(target)}
                        disabled={props.detail.tableGone}
                        handle={drag.handleProps(() => target)}
                      />
                    }
                    typeChip={
                      <Show
                        when={selected()}
                        fallback={
                          <span class="inline-flex items-center gap-1.5 rounded-full border border-edge-muted px-2 py-0.5 text-xs text-ink-muted">
                            <QuestionTypeIcon
                              type={typeId()}
                              class="size-3.5"
                            />
                            {typeLabel()}
                          </span>
                        }
                      >
                        <TypeMenu
                          current={typeId()}
                          label={typeLabel()}
                          tables={relationTables()}
                          disabled={builder.isColumnBusy(columnFacts().id)}
                          onChoose={(choice, relation) =>
                            void builder.changeType(
                              current().id,
                              choice,
                              relation
                            )
                          }
                        />
                      </Show>
                    }
                    preview={
                      <QuestionPreview
                        type={typeId()}
                        column={columnFacts()}
                        relationTableName={relationName()}
                      />
                    }
                    editor={
                      <Show
                        when={hasOptions(columnFacts().kind)}
                        fallback={
                          <div class="flex flex-col gap-1.5">
                            <QuestionPreview
                              type={typeId()}
                              column={columnFacts()}
                              relationTableName={relationName()}
                            />
                            <Show when={typeId() === 'relation'}>
                              <p class="text-xs text-ink-muted">
                                Respondents need access to{' '}
                                {relationName() ?? 'that table'} to pick its
                                rows.
                              </p>
                            </Show>
                          </div>
                        }
                      >
                        <OptionListEditor
                          options={columnFacts().options}
                          multi={
                            typeId() === 'checkboxes' || typeId() === 'tags'
                          }
                          onAdd={(label) =>
                            builder.addOption(current().id, label)
                          }
                          onRename={(optionId, label) =>
                            void builder.updateOption(current().id, optionId, {
                              label,
                            })
                          }
                          onRecolor={(optionId, color) =>
                            void builder.updateOption(current().id, optionId, {
                              color,
                            })
                          }
                          onDelete={(optionId) =>
                            void builder.deleteOption(current().id, optionId)
                          }
                        />
                      </Show>
                    }
                    footer={
                      <QuestionFooter
                        required={current().required}
                        canMoveUp={canStep('up')}
                        canMoveDown={canStep('down')}
                        sections={questionSections().map((section) => ({
                          id: section.id,
                          name: sectionName(layout(), section.id),
                          current: section.id === itemProps.sectionId,
                        }))}
                        onRequired={(required) =>
                          builder.updateQuestion(current().id, { required })
                        }
                        onDuplicate={() =>
                          void builder.duplicateQuestion(current().id)
                        }
                        onRemove={() => builder.removeQuestion(current().id)}
                        onMoveUp={() => moveByStep(current().id, 'up')}
                        onMoveDown={() => moveByStep(current().id, 'down')}
                        onMoveToSection={(sectionId) =>
                          moveToSection(current().id, sectionId)
                        }
                        onDeleteColumn={() =>
                          void confirmDeleteColumn(
                            current().id,
                            columnFacts().id
                          )
                        }
                      />
                    }
                  />
                );
              }}
            </Show>
          );
        }}
      </Show>
    );
  }
}
