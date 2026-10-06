import ArrowSquareOut from '@phosphor/arrow-square-out.svg';
import CalendarCheck from '@phosphor/calendar-check.svg';
import Database from '@phosphor/database.svg';
import Plus from '@phosphor/plus.svg';
import Rows from '@phosphor/rows.svg';
import ShieldCheck from '@phosphor/shield-check.svg';
import Warning from '@phosphor/warning.svg';
import { makeEventListener } from '@solid-primitives/event-listener';
import { Button, Dialog, Dropdown, Panel } from '@ui';
import { errAsync, okAsync, ResultAsync } from 'neverthrow';
import {
  type Accessor,
  createMemo,
  createSignal,
  createUniqueId,
  For,
  type JSX,
  Match,
  Show,
  Switch,
  untrack,
} from 'solid-js';
import { match } from 'ts-pattern';
import { v7 as uuidv7 } from 'uuid';
import {
  BookingCard,
  BookingLinkMenu,
  type BookingLinkState,
} from '../components/builder/booking-card';
import {
  BuilderPalette,
  BuilderSidebar,
  BuilderSkeleton,
  ConversionNotice,
  DropIndicator,
  HiddenColumns,
  OutlineSection,
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
import {
  type FormDetailSource,
  type FormLayoutCollaboration,
  type FormTableSource,
  type FormWriteFailure,
  useFormContext,
} from '../context/form-context';
import type { Box, MeasuredSection } from '../core/drop-target';
import { placementOf, stepPlacement } from '../core/drop-target';
import {
  bookingStep,
  brokenGateColumns,
  gateColumns,
  type QuestionPlacement,
  questionNumbers,
} from '../core/form-layout';
import type {
  FormBookingTarget,
  FormColumn,
  FormDetail,
  FormLayout,
  FormSection,
  SectionKind,
} from '../core/form-model';
import {
  placementDescription,
  routingLine,
  sectionName,
  sectionPosition,
} from '../core/layout-messages';
import {
  hasOptions,
  QUESTION_TYPE_CHOICES,
  type QuestionTypeChoice,
  type QuestionTypeId,
  questionTypeLabel,
  questionTypeOf,
} from '../core/question-types';
import { rulesSentence } from '../core/rule-sentence';
import {
  type Builder,
  createBuilder,
  type NewSectionKind,
} from '../primitives/create-builder';
import {
  createBuilderDrag,
  type DragTarget,
} from '../primitives/create-builder-drag';

function boxOf(element: Element): Box {
  const { top, bottom, left, right } = element.getBoundingClientRect();
  return { top, bottom, left, right };
}

type TrackWrites = (flush: () => ResultAsync<void, FormWriteFailure>) => void;

type BuilderViewProps = {
  source: FormDetailSource;
  detail: FormDetail;
  /** The layout every editor of the form edits at once. */
  collaboration: FormLayoutCollaboration;
  /** Registers writes a preview waits for, while the builder is open. */
  trackWrites: TrackWrites;
  onOpenDatabase: (databaseId: string) => void;
};

/**
 * The Build tab (RFC 02 §3): sections and questions on a centered column,
 * the rail beside it. Column facts go to the database's ops, presentation to
 * the layout every editor shares. Nothing is editable until it opened.
 */
export function BuilderView(props: BuilderViewProps) {
  const context = useFormContext();
  const table = context.createTableSource(
    () => props.detail.form.databaseId,
    () => props.detail.form.tableId
  );
  context.followTable(
    () => props.detail.form.databaseId,
    () => void props.source.refetch()
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
    collaboration: props.collaboration,
    columnWrites,
    notify: context.notify,
    mintId: uuidv7,
  });
  // A preview waits for new columns, and the questions naming them.
  props.trackWrites(() => ResultAsync.fromSafePromise(builder.settled()));
  // Away from this window, the other editors see nothing selected here.
  makeEventListener(window, 'blur', () => builder.setPresent(false));
  makeEventListener(window, 'focus', () => builder.setPresent(true));
  const failure = () => {
    const status = props.collaboration.status();
    return status.kind === 'error' ? status.message : undefined;
  };
  return (
    <Show
      when={builder.layout()}
      fallback={
        <Show when={failure()} fallback={<BuilderSkeleton />}>
          {(message) => (
            <div class="mx-auto w-full max-w-[680px] px-4 py-6">
              <LayoutFailure message={message()} />
            </div>
          )}
        </Show>
      }
    >
      {(layout) => (
        <BuilderCanvas
          {...props}
          builder={builder}
          layout={layout}
          table={table}
          failure={failure()}
        />
      )}
    </Show>
  );
}

function LayoutFailure(props: { message: string }) {
  return (
    <div
      role="alert"
      class="flex items-start gap-2 rounded-lg border border-failure bg-failure-bg px-3 py-2.5 text-sm text-failure-ink"
    >
      <Warning class="mt-0.5 size-4 shrink-0" aria-hidden="true" />
      {props.message}
    </div>
  );
}

/** Where edits stand when the server doesn't hold them all; nothing when it does. */
function saveNotice(collaboration: FormLayoutCollaboration) {
  if (collaboration.save() === 'unstored')
    return 'Your changes couldn’t be stored on this device. Keep this tab open until they’re saved.';
  if (collaboration.connection() === 'offline')
    return 'You’re offline. Your changes are kept on this device and sync when you reconnect.';
  if (collaboration.save() === 'unsaved')
    return 'Some changes haven’t reached the server yet. They’re kept on this device and sent again when it answers.';
  return undefined;
}

function BuilderCanvas(
  props: BuilderViewProps & {
    builder: Builder;
    layout: Accessor<FormLayout>;
    table: FormTableSource;
    /** Why the layout can't be edited now, while it shows what it last read. */
    failure: string | undefined;
  }
) {
  const context = useFormContext();
  const builder = props.builder;
  const table = props.table;
  const form = () => props.detail.form;
  const summary = context.responses.createSummary(
    () => props.detail.form.id,
    () => props.detail.access !== 'view'
  );
  // The form's name and description: a preview waits for them too.
  const metadataWrites = new Set<Promise<boolean>>();
  const writeMetadata = (written: PromiseLike<boolean>) => {
    const pending = Promise.resolve(written);
    metadataWrites.add(pending);
    const forget = () => metadataWrites.delete(pending);
    void pending.then(forget, forget);
    return pending;
  };
  props.trackWrites(() =>
    ResultAsync.fromSafePromise(Promise.all(metadataWrites)).andThen((saved) =>
      saved.every(Boolean)
        ? okAsync(undefined)
        : errAsync({ message: 'The form’s name or description wasn’t saved.' })
    )
  );
  const editorsOn = (sectionId: string, questionId: string | null) =>
    props.collaboration
      .peers()
      .filter(
        (peer) =>
          peer.selection.sectionId === sectionId &&
          peer.selection.questionId === questionId
      );
  const editors = (sectionId: string, questionId: string | null) => (
    <Show when={editorsOn(sectionId, questionId).length > 0}>
      {context.ui.renderEditors({
        get peers() {
          return editorsOn(sectionId, questionId);
        },
        selected: questionId ? 'this question' : 'this section',
      })}
    </Show>
  );
  const [editingRules, setEditingRules] = createSignal<string>();
  const [pendingRelation, setPendingRelation] = createSignal<{
    choice: QuestionTypeChoice;
    placement: QuestionPlacement | undefined;
  }>();
  // One per mount: the same form can be built in two splits.
  const instructionsId = createUniqueId();
  let viewport: HTMLDivElement | undefined;
  let column: HTMLDivElement | undefined;

  const layout = props.layout;
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
        kind: match(section.dataset.sectionKind)
          .returnType<SectionKind>()
          .with('gate', () => 'gate')
          .with('booking', () => 'booking')
          .otherwise(() => 'questions'),
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
    match(target)
      .with({ kind: 'question' }, ({ id }) => `question “${questionTitle(id)}”`)
      .with({ kind: 'section' }, ({ id }) => `“${sectionName(layout(), id)}”`)
      .with({ kind: 'new-section' }, ({ id }) =>
        id === 'gate' ? 'screener' : 'section'
      )
      .with(
        { kind: 'new-question' },
        ({ id }) => `${questionChoice(id).label} question`
      )
      .exhaustive();

  function questionChoice(id: QuestionTypeId) {
    const choice = QUESTION_TYPE_CHOICES.find((choice) => choice.id === id);
    if (!choice) throw new Error(`Unknown question palette type: ${id}`);
    return choice;
  }

  async function insertQuestion(
    choice: QuestionTypeChoice,
    placement?: QuestionPlacement,
    relation?: RelationTable
  ) {
    if (choice.kind === 'pick-table' && !relation) {
      setPendingRelation({ choice, placement });
      return;
    }
    const previousSelection = builder.selectedId();
    await builder.addQuestion(choice, relation, placement);
    const selected = builder.selectedId();
    if (!selected || selected === previousSelection) return;
    const question = viewport?.querySelector<HTMLElement>(
      `[data-form-question="${selected}"]`
    );
    question?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    question
      ?.querySelector<HTMLInputElement>('input[aria-label="Question"]')
      ?.focus({ preventScroll: true });
  }

  /** Focus a question's or section's drag handle, wherever it now renders. */
  const focusHandle = (target: DragTarget) =>
    viewport
      ?.querySelector<HTMLElement>(
        `[data-drag-handle="${target.kind}:${target.id}"]`
      )
      ?.focus({ preventScroll: false });

  const drag = createBuilderDrag({
    layout,
    viewport: () => viewport,
    canvas: () => column,
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
    dropNewSection: (kind, index) => {
      const id = builder.addSection(kind, index);
      if (id && kind === 'gate') setEditingRules(id);
      return id;
    },
    dropNewQuestion: (type, placement) =>
      void insertQuestion(questionChoice(type), placement),
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

  const booking = () => bookingStep(layout());
  const bookingLinks = context.booking.createLinks(
    () => !props.detail.tableGone
  );
  /** What a booking card shows of its own `target`. */
  const bookingLinkState = (
    target: Accessor<FormBookingTarget | undefined>
  ): Accessor<BookingLinkState> => {
    const event = context.booking.createEvent(target);
    return () => {
      const read = event.value();
      if (read === undefined)
        return event.failure() ? { kind: 'unavailable' } : { kind: 'loading' };
      if (read === null) return { kind: 'unavailable' };
      return {
        kind: 'ready',
        title: read.event.title,
        durationMinutes: read.event.durationMinutes,
        host: read.profile.name,
      };
    };
  };

  /** Bring the booking step into view and focus it. */
  const revealBooking = (sectionId: string) =>
    queueMicrotask(() => {
      const card = viewport?.querySelector<HTMLElement>(
        `[data-form-section="${sectionId}"]`
      );
      card?.scrollIntoView({ block: 'center', behavior: 'smooth' });
      card?.focus({ preventScroll: true });
    });

  const addBooking = (target: FormBookingTarget) => {
    const result = builder.addBooking(target);
    if (result) revealBooking(result.sectionId);
  };

  const bookingMenu = (menuProps: {
    trigger: JSX.Element;
    triggerLabel?: string;
    triggerClass: string;
    triggerVariant: 'outline' | 'ghost';
    selected?: FormBookingTarget;
    onChoose: (target: FormBookingTarget) => void;
  }) => (
    <BookingLinkMenu
      links={bookingLinks.value()}
      failed={!!bookingLinks.failure()}
      selected={menuProps.selected}
      trigger={menuProps.trigger}
      triggerLabel={menuProps.triggerLabel}
      triggerClass={menuProps.triggerClass}
      triggerVariant={menuProps.triggerVariant}
      disabled={props.detail.tableGone}
      onChoose={menuProps.onChoose}
      onCreate={context.booking.openSettings}
    />
  );

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
      <div class="mx-auto grid w-full max-w-[1280px] grid-cols-1 items-start justify-center gap-5 p-4 @5xl/builder:grid-cols-[256px_minmax(0,680px)_256px] @5xl/builder:py-6">
        <div class="mx-auto w-full max-w-[680px] @5xl/builder:col-span-3 @5xl/builder:max-w-none">
          <TitleCard
            databaseLink={
              <Button
                variant="outline"
                class="max-w-full gap-2"
                aria-label={`Open database ${table.databaseName() ?? 'Database'}`}
                tooltip={table.databaseName() ?? 'Database'}
                onClick={() => props.onOpenDatabase(form().databaseId)}
              >
                <Database class="size-4 text-code" aria-hidden="true" />
                <span class="truncate">
                  {table.databaseName() ?? 'Database'}
                </span>
                <ArrowSquareOut class="size-3.5" aria-hidden="true" />
              </Button>
            }
            name={form().name}
            description={form().description}
            onName={(name) =>
              writeMetadata(
                context.renameForm(form().id, name).match(
                  () => true,
                  (failure) => {
                    context.notify.failure(
                      `The form couldn’t be renamed: ${failure.message}`
                    );
                    return false;
                  }
                )
              )
            }
            onDescription={(description) =>
              writeMetadata(
                context.updateMetadata(form().id, { description }).match(
                  () => true,
                  (failure) => {
                    context.notify.failure(
                      `The description wasn’t saved: ${failure.message}`
                    );
                    return false;
                  }
                )
              )
            }
            meta={
              <>
                <li>
                  {form().audience === 'public'
                    ? 'Anyone with the link'
                    : 'Invited people'}
                </li>
                <li>
                  {questionSections().length === 1
                    ? '1 section'
                    : `${questionSections().length} sections`}
                </li>
                <Show when={gateCount() > 0}>
                  <li>
                    {gateCount() === 1
                      ? '1 screener'
                      : `${gateCount()} screeners`}
                  </li>
                </Show>
                <Show when={booking()}>
                  <li>Ends with booking</li>
                </Show>
              </>
            }
          />
        </div>
        <BuilderSidebar
          outline={
            <ul class="flex flex-col gap-2">
              <For each={layout().sections}>
                {(section) => (
                  <OutlineSection
                    name={sectionName(layout(), section.id)}
                    kind={section.kind}
                    onSelectSection={() => {
                      builder.focusSection(section.id);
                      viewport
                        ?.querySelector(`[data-form-section="${section.id}"]`)
                        ?.scrollIntoView({
                          block: 'start',
                          behavior: 'smooth',
                        });
                    }}
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
        />
        <div
          role="region"
          aria-label="Form canvas"
          class="mx-auto flex w-full max-w-[680px] min-w-0 flex-col gap-4"
        >
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
          <Show when={props.failure}>
            {(message) => <LayoutFailure message={message()} />}
          </Show>
          <Show when={props.collaboration.publicationError()}>
            {(problem) => (
              <LayoutFailure
                message={`Respondents still see the last valid version of this form. ${problem()}`}
              />
            )}
          </Show>
          <Show when={saveNotice(props.collaboration)}>
            {(notice) => (
              <p
                role="status"
                class="rounded-lg border border-edge-muted bg-panel px-3 py-2 text-sm text-ink-muted"
              >
                {notice()}
              </p>
            )}
          </Show>
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
          <div ref={column} class="relative flex min-h-60 flex-col gap-4">
            <Show when={layout().sections.length === 0}>
              <div class="flex min-h-72 items-center justify-center rounded-xl border border-dashed border-edge bg-surface p-6 text-sm text-ink-muted">
                Click a question type or drag it here.
              </div>
            </Show>
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
                        ? 'Delete screener'
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
                            eyebrow={`Screener ${sectionPosition(layout(), sectionId)}`}
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
                        <Match when={current().kind === 'booking' && current()}>
                          {(booking) => {
                            const link = bookingLinkState(
                              () => booking().bookingTarget ?? undefined
                            );
                            return (
                              <BookingCard
                                sectionId={sectionId}
                                title={current().title}
                                description={current().description}
                                link={link()}
                                menu={
                                  <SectionMenu
                                    label={`${sectionName(layout(), sectionId)} actions`}
                                    canMoveUp={false}
                                    canMoveDown={false}
                                    deleteLabel="Remove booking step"
                                    onMoveUp={() => {}}
                                    onMoveDown={() => {}}
                                    onDelete={() =>
                                      builder.removeSection(sectionId)
                                    }
                                  />
                                }
                                change={bookingMenu({
                                  trigger: 'Change',
                                  triggerLabel: 'Change booking link',
                                  triggerClass: 'shrink-0',
                                  triggerVariant: 'outline',
                                  selected:
                                    current().bookingTarget ?? undefined,
                                  onChoose: (target) =>
                                    builder.changeBookingTarget(
                                      sectionId,
                                      target
                                    ),
                                })}
                                onTitle={(title) =>
                                  builder.updateSection(sectionId, { title })
                                }
                                onDescription={(description) =>
                                  builder.updateSection(sectionId, {
                                    description,
                                  })
                                }
                              />
                            );
                          }}
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
                            editors={editors(sectionId, null)}
                            onTitle={(title) =>
                              builder.updateSection(sectionId, { title })
                            }
                            onDescription={(description) =>
                              builder.updateSection(sectionId, { description })
                            }
                            routing={
                              <RoutingFooter
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
        <BuilderPalette
          question={(choice) => <AddQuestionButton choice={choice} />}
          structure={
            <div class="flex flex-col gap-0.5">
              <div class="grid grid-cols-2 gap-0.5">
                <AddSectionButton kind="questions">
                  <Rows class="size-3.5" />
                  Section
                </AddSectionButton>
                <AddSectionButton kind="gate">
                  <ShieldCheck class="size-3.5" />
                  Screener
                </AddSectionButton>
              </div>
              <Show
                when={booking()}
                fallback={
                  <Show when={context.booking.available()}>
                    {bookingMenu({
                      trigger: (
                        <>
                          <CalendarCheck class="size-3.5" />
                          Booking
                        </>
                      ),
                      triggerClass:
                        'w-full justify-start gap-1 rounded-md px-1 text-xs',
                      triggerVariant: 'ghost',
                      onChoose: addBooking,
                    })}
                  </Show>
                }
              >
                {(existing) => (
                  <Button
                    variant="ghost"
                    size="md"
                    class="w-full justify-start gap-1 rounded-md px-1 text-xs"
                    onClick={() => revealBooking(existing().id)}
                  >
                    <CalendarCheck class="size-3.5" />
                    Booking
                  </Button>
                )}
              </Show>
              <Dropdown>
                <Dropdown.Trigger
                  variant="ghost"
                  size="md"
                  class="w-full justify-start gap-1 rounded-md px-1 text-xs"
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
        />
      </div>
      <Show when={pendingRelation()}>
        {(pending) => (
          <Dialog
            open
            onOpenChange={(open) => {
              if (!open) setPendingRelation(undefined);
            }}
            class="w-96 max-w-[calc(100vw-2rem)]"
          >
            <Panel>
              <Panel.Body>
                <div class="flex flex-col gap-3 p-5">
                  <Dialog.Title class="text-base font-semibold">
                    Choose a table
                  </Dialog.Title>
                  <Dialog.Description class="text-sm text-ink-muted">
                    Respondents choose a row from this table.
                  </Dialog.Description>
                  <For each={relationTables()}>
                    {(relation) => (
                      <Button
                        variant="outline"
                        class="justify-start"
                        onClick={() => {
                          const current = pending();
                          setPendingRelation(undefined);
                          void insertQuestion(
                            current.choice,
                            current.placement,
                            relation
                          );
                        }}
                      >
                        <Database class="size-4" />
                        {relation.name}
                      </Button>
                    )}
                  </For>
                  <Button
                    variant="ghost"
                    onClick={() => setPendingRelation(undefined)}
                  >
                    Cancel
                  </Button>
                </div>
              </Panel.Body>
            </Panel>
          </Dialog>
        )}
      </Show>
    </div>
  );

  function AddQuestionButton(buttonProps: { choice: QuestionTypeChoice }) {
    const target = (): DragTarget => ({
      kind: 'new-question',
      id: buttonProps.choice.id,
    });
    const handle = drag.handleProps(target);
    return (
      <Button
        variant="ghost"
        size="md"
        class="w-full touch-none justify-start gap-1 rounded-md px-1 text-xs"
        aria-label={`Add ${buttonProps.choice.label}`}
        data-drag-source
        data-drag-handle={`new-question:${buttonProps.choice.id}`}
        disabled={
          props.detail.tableGone ||
          (buttonProps.choice.kind === 'pick-table' &&
            relationTables().length === 0)
        }
        onPointerDown={handle.onPointerDown}
        onKeyDown={handle.onKeyDown}
        onBlur={handle.onBlur}
        onClick={(event) => {
          handle.onClick(event);
          if (!event.defaultPrevented) void insertQuestion(buttonProps.choice);
        }}
      >
        <QuestionTypeIcon
          type={buttonProps.choice.id}
          class="size-3.5 text-ink-muted"
        />
        <span>{buttonProps.choice.label}</span>
      </Button>
    );
  }

  function AddSectionButton(buttonProps: {
    kind: NewSectionKind;
    children: JSX.Element;
  }) {
    const target = (): DragTarget => ({
      kind: 'new-section',
      id: buttonProps.kind,
    });
    const handle = drag.handleProps(target);
    return (
      <Button
        variant="ghost"
        size="md"
        class="w-full touch-none justify-start gap-1 rounded-md px-1 text-xs"
        data-drag-source
        data-drag-handle={`new-section:${buttonProps.kind}`}
        disabled={props.detail.tableGone}
        onPointerDown={handle.onPointerDown}
        onKeyDown={handle.onKeyDown}
        onBlur={handle.onBlur}
        onClick={(event) => {
          handle.onClick(event);
          if (event.defaultPrevented) return;
          const id = builder.addSection(buttonProps.kind);
          if (!id) return;
          if (buttonProps.kind === 'gate') setEditingRules(id);
          drag.refocus({ kind: 'section', id });
        }}
      >
        {buttonProps.children}
      </Button>
    );
  }

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
                  This question’s column was deleted.
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
                    editors={editors(itemProps.sectionId, current().id)}
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
