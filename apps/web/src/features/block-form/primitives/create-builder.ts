import { err, type Result, type ResultAsync } from 'neverthrow';
import {
  type Accessor,
  batch,
  createMemo,
  createSignal,
  onCleanup,
} from 'solid-js';
import type {
  FormColumnWrites,
  FormWriteFailure,
  OptionChange,
} from '../context/form-context';
import {
  addQuestion as addLayoutQuestion,
  addSection as addLayoutSection,
  type LayoutRefusal,
  hiddenColumns as layoutHiddenColumns,
  moveQuestion as moveLayoutQuestion,
  moveSection as moveLayoutSection,
  type PrunedLayout,
  pruneBrokenRules,
  type QuestionPatch,
  type QuestionPlacement,
  removeQuestion as removeLayoutQuestion,
  removeSection as removeLayoutSection,
  type SectionPatch,
  swapQuestionColumn,
  updateQuestion as updateLayoutQuestion,
  updateSection as updateLayoutSection,
} from '../core/form-layout';
import type {
  FormColumn,
  FormColumnKind,
  FormDetail,
  FormLayout,
  FormQuestion,
  FormSection,
  QuestionWidget,
  SectionKind,
} from '../core/form-model';
import { layoutRefusalMessage, sectionName } from '../core/layout-messages';
import {
  hasOptions,
  type QuestionTypeChoice,
  resolvedWidget,
  sameColumnKind,
  widgetFits,
} from '../core/question-types';
import { createLayoutSaver } from './create-layout-saver';

/** A type change the column refused because some answers do not fit. */
export type PendingConversion = {
  questionId: string;
  to: FormColumnKind;
  widget: QuestionWidget | null;
  label: string;
  message: string;
};

export type BuilderOptions = {
  /** The form as the server last answered it. */
  detail: Accessor<FormDetail | undefined>;
  refetch: () => Promise<void>;
  /** Every column of the linked table, for editors. */
  tableColumns: Accessor<FormColumn[] | undefined>;
  saveLayout: (layout: FormLayout) => ResultAsync<FormDetail, FormWriteFailure>;
  columnWrites: Accessor<FormColumnWrites | undefined>;
  notify: {
    success: (message: string) => void;
    failure: (message: string) => void;
  };
  mintId: () => string;
  /** Layout saves wait this long for edits to pause. */
  delayMs: number;
};

/**
 * A column write as the builder shows it before the server has it: `patch`
 * turns the column as known into the column as edited (`undefined` when the
 * server does not have it yet).
 */
type PendingColumnWrite = {
  sequence: number;
  columnId: string;
  patch: (column: FormColumn | undefined) => FormColumn | undefined;
  written: boolean;
};

const DEFAULT_GATE_MESSAGE =
  'Thanks for your interest. This form can’t take your response.';

/** A write's answer; one that throws is a failure of that write, so the queue goes on. */
async function sendColumnWrite<Value>(
  write: () => PromiseLike<Result<Value, FormWriteFailure>>
): Promise<Result<Value, FormWriteFailure>> {
  try {
    return await write();
  } catch (error) {
    return err({
      message:
        error instanceof Error ? error.message : 'The change couldn’t be sent.',
    });
  }
}

/** The column kind a type choice asks for; a relation needs its table picked. */
function kindOfChoice(
  choice: QuestionTypeChoice,
  relationTable: { databaseId: string; tableId: string } | undefined
): FormColumnKind | undefined {
  if (choice.kind !== 'pick-table') return choice.kind;
  return (
    relationTable && {
      type: 'relation',
      database: relationTable.databaseId,
      table: relationTable.tableId,
    }
  );
}

/** `base`, or `base 2`, `base 3`… while another column has it, ignoring case. */
export function uniqueColumnName(base: string, taken: readonly string[]) {
  const names = new Set(taken.map((name) => name.trim().toLowerCase()));
  let candidate = base;
  for (let suffix = 2; names.has(candidate.toLowerCase()); suffix++)
    candidate = `${base} ${suffix}`;
  return candidate;
}

/**
 * The builder's state: the layout as edited (optimistic, saved debounced and
 * serialized), column facts with pending edits shown, and the edits
 * themselves. Column facts go to the database's ops at once; presentation
 * goes to the form's layout.
 */
export function createBuilder(options: BuilderOptions) {
  const [local, setLocal] = createSignal<FormLayout>();
  const [selectedId, setSelectedIdSignal] = createSignal<string>();
  // A questions section the person just added or focused: new questions go
  // to its end until a question is selected again.
  const [targetSectionId, setTargetSectionId] = createSignal<string>();
  const setSelectedId = (questionId: string | undefined) => {
    batch(() => {
      setSelectedIdSignal(questionId);
      setTargetSectionId(undefined);
    });
  };
  const focusSection = (sectionId: string) => {
    batch(() => {
      setSelectedIdSignal(undefined);
      setTargetSectionId(sectionId);
    });
  };
  const [conversion, setConversion] = createSignal<PendingConversion>();
  const [pendingWrites, setPendingWrites] = createSignal<
    readonly PendingColumnWrite[]
  >([]);

  const saver = createLayoutSaver({
    save: options.saveLayout,
    delayMs: options.delayMs,
    onSaved: (_detail, idle) => {
      if (idle) setLocal(undefined);
    },
    onFailed: (failure, newerPending) => {
      if (newerPending) {
        // The newer layout carries every edit since: it is being saved.
        options.notify.failure(
          `An earlier change to the form wasn’t saved: ${failure.message} Saving your latest changes.`
        );
        return;
      }
      setLocal(undefined);
      options.notify.failure(
        `Your last change to the form wasn’t saved: ${failure.message}`
      );
      void options.refetch();
    },
  });
  // Leaving the builder sends what is waiting rather than dropping it.
  onCleanup(() => void saver.flush());

  const layout = (): FormLayout | undefined =>
    local() ?? options.detail()?.layout;

  /** Column facts as the server last answered: the table's, else the form's. */
  const serverColumns = () => {
    const byId = new Map<string, FormColumn>();
    for (const column of options.detail()?.columns ?? [])
      byId.set(column.id, column);
    for (const column of options.tableColumns() ?? [])
      byId.set(column.id, column);
    return byId;
  };

  /** The server's columns with the writes it has not answered for laid over, in order. */
  function withPending(
    byId: Map<string, FormColumn>,
    writes: readonly PendingColumnWrite[]
  ) {
    for (const write of writes) {
      const next = write.patch(byId.get(write.columnId));
      if (next) byId.set(write.columnId, next);
      else byId.delete(write.columnId);
    }
    return byId;
  }

  const columns = createMemo(() =>
    withPending(serverColumns(), pendingWrites())
  );

  const managedColumnIds = () => {
    const form = options.detail()?.form;
    return [form?.submittedColumnId ?? null, form?.respondentColumnId ?? null];
  };

  const hidden = () => {
    const current = layout();
    const table = options.tableColumns();
    if (!current || !table) return [];
    return layoutHiddenColumns(current, table, managedColumnIds());
  };

  const findQuestion = (questionId: string) => {
    for (const section of layout()?.sections ?? []) {
      const question = section.questions.find((item) => item.id === questionId);
      if (question) return { section, question };
    }
    return undefined;
  };

  const columnName = (columnId: string) =>
    columns().get(columnId)?.name ?? 'this question';

  const refusalMessage = (refusal: LayoutRefusal) => {
    const current = layout();
    return layoutRefusalMessage(refusal, {
      section: (sectionId) =>
        current ? sectionName(current, sectionId) : 'This section',
      column: columnName,
    });
  };

  /** Show and schedule an edited layout; a refusal is told and nothing changes. */
  function commit(
    edit: (current: FormLayout) => Result<FormLayout, LayoutRefusal>
  ): boolean {
    const current = layout();
    if (!current) return false;
    const result = edit(current);
    if (result.isErr()) {
      options.notify.failure(refusalMessage(result.error));
      return false;
    }
    // An edit that changes nothing (empty rules saved as empty) writes nothing.
    if (JSON.stringify(result.value) === JSON.stringify(current)) return true;
    setLocal(result.value);
    saver.schedule(result.value);
    return true;
  }

  function commitPruned(
    edit: (current: FormLayout) => Result<PrunedLayout, LayoutRefusal>
  ): boolean {
    let pruned = 0;
    const committed = commit((current) =>
      edit(current).map((result) => {
        pruned = result.prunedConditions;
        return result.layout;
      })
    );
    if (committed && pruned > 0)
      options.notify.success(
        pruned === 1
          ? 'Removed 1 gate rule that checked it.'
          : `Removed ${pruned} gate rules that checked it.`
      );
    return committed;
  }

  // Column writes go one at a time, in the order they were made, so each
  // lands on what the one before left and a slow write never lands last out
  // of turn. Each shows at once as a patch; patches go when a read that
  // started after they landed answers, so a stale read never undoes an edit.
  let lastSequence = 0;
  let queueTail: Promise<unknown> = Promise.resolve();
  let unfinished = 0;
  let reading: Promise<void> | undefined;
  let idleWaiters: (() => void)[] = [];

  function settleIdle() {
    if (unfinished > 0 || reading) return;
    const waiting = idleWaiters;
    idleWaiters = [];
    for (const resolve of waiting) resolve();
  }

  /** Read the server once the queue drains; drop the patches that read covers. */
  function reconcile() {
    if (unfinished > 0 || reading) return;
    const covered = new Set(
      pendingWrites()
        .filter((write) => write.written)
        .map((write) => write.sequence)
    );
    reading = (async () => {
      try {
        await options.refetch();
        setPendingWrites((current) =>
          current.filter((write) => !covered.has(write.sequence))
        );
      } catch {
        // The read failed: the landed writes stay shown, they are the truth.
        return;
      } finally {
        reading = undefined;
      }
      // Writes that landed during the read need a read of their own.
      if (pendingWrites().some((write) => write.written)) reconcile();
    })().finally(settleIdle);
  }

  /**
   * Queue a column write. `patch` shows at once; `write` runs after every
   * earlier one, given the column as it stands once they landed.
   */
  function enqueueColumnWrite<Value>(
    columnId: string,
    patch: PendingColumnWrite['patch'],
    write: (
      writes: FormColumnWrites,
      before: FormColumn | undefined
    ) => PromiseLike<Result<Value, FormWriteFailure>>
  ): Promise<Result<Value, FormWriteFailure>> | undefined {
    const writes = options.columnWrites();
    if (!writes) return undefined;
    const entry: PendingColumnWrite = {
      sequence: ++lastSequence,
      columnId,
      patch,
      written: false,
    };
    setPendingWrites((current) => [...current, entry]);
    const idle = unfinished === 0;
    unfinished += 1;
    const execute = async () => {
      const earlier = pendingWrites().filter(
        (pending) => pending.sequence < entry.sequence
      );
      const before = withPending(serverColumns(), earlier).get(columnId);
      const result = await sendColumnWrite(() => write(writes, before));
      if (result.isErr())
        setPendingWrites((current) =>
          current.filter((pending) => pending.sequence !== entry.sequence)
        );
      else
        setPendingWrites((current) =>
          current.map((pending) =>
            pending.sequence === entry.sequence
              ? { ...pending, written: true }
              : pending
          )
        );
      unfinished -= 1;
      reconcile();
      return result;
    };
    // An idle queue sends at once; otherwise after the write before it.
    const run = idle ? execute() : queueTail.then(execute);
    queueTail = run;
    return run;
  }

  /**
   * Where a new question goes: at the end of the section just added or
   * focused, after the selected question, or at the end of the last section.
   */
  function defaultPlacement(
    current: FormLayout
  ): QuestionPlacement | undefined {
    const target = current.sections.find(
      (section) =>
        section.id === targetSectionId() && section.kind === 'questions'
    );
    if (target) return { sectionId: target.id, index: target.questions.length };
    const selected = selectedId();
    if (selected) {
      for (const section of current.sections) {
        const index = section.questions.findIndex(
          (item) => item.id === selected
        );
        if (index >= 0) return { sectionId: section.id, index: index + 1 };
      }
    }
    const last = current.sections.findLast(
      (section) => section.kind === 'questions'
    );
    return last && { sectionId: last.id, index: last.questions.length };
  }

  function newSection(kind: SectionKind): FormSection {
    return {
      id: options.mintId(),
      title: '',
      description: '',
      kind,
      gateRules:
        kind === 'gate' ? { conjunction: 'and', conditions: [] } : null,
      gateMessage: kind === 'gate' ? DEFAULT_GATE_MESSAGE : '',
      questions: [],
    };
  }

  /** The layout with somewhere to put a question: a questions section is made when there is none. */
  function withQuestionsSection(current: FormLayout) {
    if (current.sections.some((section) => section.kind === 'questions'))
      return current;
    return { sections: [...current.sections, newSection('questions')] };
  }

  /**
   * Two writes, in order: the column, then the layout naming it. The question
   * shows at once; the layout waits for the column. If the column is refused
   * the question goes again; if the layout is refused, the column stays and
   * lists under hidden columns.
   */
  async function addNewColumnQuestion(input: {
    name: string;
    kind: FormColumnKind;
    options: { id: string; label: string }[];
    question: Omit<FormQuestion, 'id' | 'columnId'>;
    placement?: QuestionPlacement;
  }) {
    const current = layout();
    if (!options.columnWrites() || !current) return;
    const columnId = options.mintId();
    const questionId = options.mintId();
    const prepared = withQuestionsSection(current);
    const placement = input.placement ?? defaultPlacement(prepared);
    if (!placement) return;
    const added = addLayoutQuestion(
      prepared,
      { id: questionId, columnId, ...input.question },
      placement
    );
    if (added.isErr()) {
      options.notify.failure(refusalMessage(added.error));
      return;
    }
    const release = saver.hold();
    const column: FormColumn = {
      id: columnId,
      name: input.name,
      kind: input.kind,
      options: input.options.map((option) => ({ ...option, color: null })),
    };
    let creating: Promise<Result<void, FormWriteFailure>> | undefined;
    batch(() => {
      creating = enqueueColumnWrite(
        columnId,
        () => column,
        (columnWrites) =>
          columnWrites.create({
            id: columnId,
            name: input.name,
            kind: input.kind,
            options: input.options,
          })
      );
      setLocal(added.value);
      saver.schedule(added.value);
      setSelectedId(questionId);
    });
    if (!creating) {
      release();
      return;
    }
    const created = await creating;
    if (created.isErr()) {
      const now = layout();
      const removed = now && removeLayoutQuestion(now, questionId);
      if (removed?.isOk()) {
        setLocal(removed.value.layout);
        saver.schedule(removed.value.layout);
      }
      release();
      if (selectedId() === questionId) setSelectedId(undefined);
      options.notify.failure(
        `The question couldn’t be added: ${created.error.message}`
      );
      return;
    }
    release();
    await saver.flush();
  }

  /** A file question on a public form is refused, and said so. */
  function refusesFileOnPublic(widget: QuestionWidget | null | undefined) {
    if (widget !== 'file' || options.detail()?.form.audience !== 'public')
      return false;
    options.notify.failure(
      'File upload needs respondents to sign in. Switch “Who can respond” to workspace members first.'
    );
    return true;
  }

  function takenNames() {
    return [...columns().values()].map((column) => column.name);
  }

  return {
    layout,
    columns,
    column: (columnId: string) => columns().get(columnId),
    hiddenColumns: hidden,
    saveState: saver.state,
    selectedId,
    select: setSelectedId,
    /** Aim the next added question at the end of this section. */
    focusSection,
    targetSectionId,
    conversion,
    dismissConversion: () => setConversion(undefined),
    isColumnBusy: (columnId: string) =>
      pendingWrites().some((write) => write.columnId === columnId),
    /** Resolves once every queued column write landed and was read back. */
    settled: () =>
      new Promise<void>((resolve) => {
        idleWaiters.push(resolve);
        settleIdle();
      }),

    /** Why moving a question there is refused, if it is. */
    questionMoveRefusal(questionId: string, placement: QuestionPlacement) {
      const current = layout();
      if (!current) return undefined;
      const moved = moveLayoutQuestion(current, questionId, placement);
      return moved.isErr() ? refusalMessage(moved.error) : undefined;
    },

    sectionMoveRefusal(sectionId: string, index: number) {
      const current = layout();
      if (!current) return undefined;
      const moved = moveLayoutSection(current, sectionId, index);
      return moved.isErr() ? refusalMessage(moved.error) : undefined;
    },

    addQuestion(
      choice: QuestionTypeChoice,
      relationTable?: { databaseId: string; tableId: string },
      placement?: QuestionPlacement
    ) {
      const kind = kindOfChoice(choice, relationTable);
      if (!kind) return Promise.resolve();
      if (refusesFileOnPublic(choice.widget)) return Promise.resolve();
      return addNewColumnQuestion({
        name: uniqueColumnName('Untitled question', takenNames()),
        kind,
        options: hasOptions(kind)
          ? [{ id: options.mintId(), label: 'Option 1' }]
          : [],
        question: { helpText: '', required: false, widget: choice.widget },
        placement,
      });
    },

    duplicateQuestion(questionId: string) {
      const found = findQuestion(questionId);
      const column = found && columns().get(found.question.columnId);
      const current = layout();
      if (!found || !column || !current) return Promise.resolve();
      const index = found.section.questions.indexOf(found.question);
      return addNewColumnQuestion({
        name: uniqueColumnName(`${column.name} (copy)`, takenNames()),
        kind: column.kind,
        options: column.options.map((option) => ({
          id: options.mintId(),
          label: option.label,
        })),
        question: {
          helpText: found.question.helpText,
          required: found.question.required,
          widget: found.question.widget,
        },
        placement: { sectionId: found.section.id, index: index + 1 },
      });
    },

    addExistingColumn(columnId: string, placement?: QuestionPlacement) {
      const current = layout();
      if (!current) return;
      const prepared = withQuestionsSection(current);
      const target = placement ?? defaultPlacement(prepared);
      if (!target) return;
      const questionId = options.mintId();
      if (
        commit(() =>
          addLayoutQuestion(
            prepared,
            {
              id: questionId,
              columnId,
              helpText: '',
              required: false,
              widget: null,
            },
            target
          )
        )
      )
        setSelectedId(questionId);
    },

    moveQuestion(questionId: string, placement: QuestionPlacement) {
      return commit((current) =>
        moveLayoutQuestion(current, questionId, placement)
      );
    },

    /** Take a question off the form; its column and answers stay. */
    removeQuestion(questionId: string) {
      const current = layout();
      const ordered = current?.sections.flatMap((section) => section.questions);
      const at = ordered?.findIndex((item) => item.id === questionId) ?? -1;
      const neighbour = ordered?.[at + 1] ?? ordered?.[at - 1];
      if (
        commitPruned((layoutNow) =>
          removeLayoutQuestion(layoutNow, questionId)
        ) &&
        selectedId() === questionId
      )
        setSelectedId(neighbour?.id);
    },

    updateQuestion(questionId: string, patch: QuestionPatch) {
      if (refusesFileOnPublic(patch.widget)) return false;
      return commit((current) =>
        updateLayoutQuestion(current, questionId, patch)
      );
    },

    async renameQuestion(questionId: string, name: string) {
      const found = findQuestion(questionId);
      const column = found && columns().get(found.question.columnId);
      const next = name.trim();
      if (!column || !next || next === column.name) return;
      if (
        [...columns().values()].some(
          (other) =>
            other.id !== column.id &&
            other.name.trim().toLowerCase() === next.toLowerCase()
        )
      ) {
        options.notify.failure(`Another column is already called “${next}”.`);
        return;
      }
      const result = await enqueueColumnWrite(
        column.id,
        (known) => known && { ...known, name: next },
        (writes, before) =>
          writes.rename(column.id, next, before?.name ?? column.name)
      );
      if (result?.isErr())
        options.notify.failure(
          `The question couldn’t be renamed: ${result.error.message}`
        );
    },

    /**
     * Ask the question another way. The same column kind changes only the
     * widget; another kind changes the column's type, which the database
     * refuses when answers would not fit, offering a conversion instead.
     */
    async changeType(
      questionId: string,
      choice: QuestionTypeChoice,
      relationTable?: { databaseId: string; tableId: string }
    ) {
      const found = findQuestion(questionId);
      const column = found && columns().get(found.question.columnId);
      if (!found || !column) return;
      const to = kindOfChoice(choice, relationTable);
      if (!to) return;
      if (refusesFileOnPublic(choice.widget)) return;
      // The same kind asked another way changes only the widget.
      if (sameColumnKind(column.kind, to)) {
        commit((current) =>
          updateLayoutQuestion(current, questionId, { widget: choice.widget })
        );
        return;
      }
      // The stored widget may not fit the new kind: no layout goes out until
      // it is, and none is in flight when the type changes.
      const release = saver.hold();
      const result = await enqueueColumnWrite(
        column.id,
        (known) =>
          known && {
            ...known,
            kind: to,
            options: hasOptions(to) ? known.options : [],
          },
        async (writes) => {
          await saver.settled();
          return await writes.changeType(column.id, to);
        }
      );
      if (!result || result.isErr()) {
        release();
        if (result?.isErr())
          setConversion({
            questionId,
            to,
            widget: choice.widget,
            label: choice.label,
            message: result.error.message,
          });
        return;
      }
      commit((current) =>
        updateLayoutQuestion(current, questionId, {
          widget: widgetFits(to, choice.widget)
            ? choice.widget
            : resolvedWidget(to, null),
        })
      );
      release();
    },

    /** The refused type change, as a new column of that type holding what converts. */
    async convertQuestion() {
      const pending = conversion();
      const found = pending && findQuestion(pending.questionId);
      const column = found && columns().get(found.question.columnId);
      if (!pending || !found || !column || !options.columnWrites()) return;
      setConversion(undefined);
      await saver.flush();
      const release = saver.hold();
      const name = uniqueColumnName(
        `${column.name} (${pending.label})`,
        takenNames()
      );
      const converted = await enqueueColumnWrite(
        column.id,
        (known) => known,
        (columnWrites) => columnWrites.convert(column.id, pending.to, name)
      );
      if (!converted) {
        release();
        return;
      }
      if (converted.isErr()) {
        release();
        options.notify.failure(
          `The question couldn’t be converted: ${converted.error.message}`
        );
        return;
      }
      const newColumnId = converted.value;
      commitPruned((current) =>
        swapQuestionColumn(current, pending.questionId, newColumnId).andThen(
          (swapped) =>
            updateLayoutQuestion(swapped.layout, pending.questionId, {
              widget: pending.widget,
            }).map((layoutNow) => ({ ...swapped, layout: layoutNow }))
        )
      );
      release();
      await saver.flush();
      options.notify.success(
        `Converted. “${column.name}” keeps its original answers and is listed under columns not on this form.`
      );
    },

    async addOption(questionId: string, label: string) {
      const found = findQuestion(questionId);
      const column = found && columns().get(found.question.columnId);
      const next = label.trim();
      if (!column || !next) return false;
      if (
        column.options.some(
          (option) => option.label.toLowerCase() === next.toLowerCase()
        )
      ) {
        options.notify.failure(`“${next}” is already an option.`);
        return false;
      }
      const option = { id: options.mintId(), label: next };
      const result = await enqueueColumnWrite(
        column.id,
        (known) =>
          known && {
            ...known,
            options: [...known.options, { ...option, color: null }],
          },
        (writes) => writes.addOptions(column.id, [option])
      );
      if (result?.isErr()) {
        options.notify.failure(
          `The option couldn’t be added: ${result.error.message}`
        );
        return false;
      }
      return !!result;
    },

    async updateOption(
      questionId: string,
      optionId: string,
      change: OptionChange
    ) {
      const found = findQuestion(questionId);
      const column = found && columns().get(found.question.columnId);
      if (!column) return;
      const label = change.label?.trim();
      if (change.label !== undefined && !label) return;
      if (
        label &&
        column.options.some(
          (option) =>
            option.id !== optionId &&
            option.label.toLowerCase() === label.toLowerCase()
        )
      ) {
        options.notify.failure(`“${label}” is already an option.`);
        return;
      }
      const result = await enqueueColumnWrite(
        column.id,
        (known) =>
          known && {
            ...known,
            options: known.options.map((option) =>
              option.id === optionId
                ? {
                    ...option,
                    ...(label !== undefined && { label }),
                    ...(change.color !== undefined && { color: change.color }),
                  }
                : option
            ),
          },
        (writes) =>
          writes.updateOption(column.id, optionId, {
            ...(label !== undefined && { label }),
            ...(change.color !== undefined && { color: change.color }),
          })
      );
      if (result?.isErr())
        options.notify.failure(
          `The option couldn’t be changed: ${result.error.message}`
        );
    },

    async deleteOption(questionId: string, optionId: string) {
      const found = findQuestion(questionId);
      const column = found && columns().get(found.question.columnId);
      if (!column) return;
      const result = await enqueueColumnWrite(
        column.id,
        (known) =>
          known && {
            ...known,
            options: known.options.filter((option) => option.id !== optionId),
          },
        (writes) => writes.deleteOption(column.id, optionId)
      );
      if (result?.isErr())
        options.notify.failure(
          `The option couldn’t be deleted: ${result.error.message}`
        );
    },

    /**
     * Delete the question's column and every answer in it: the grid's own
     * destructive action. The question goes when the form is read back.
     */
    async deleteColumn(questionId: string) {
      const found = findQuestion(questionId);
      if (!found || !options.columnWrites()) return false;
      const columnId = found.question.columnId;
      // The question and the rules naming its column go first: a stored gate
      // naming a deleted column would refuse every submission and save.
      commitPruned((current) => removeLayoutQuestion(current, questionId));
      if (selectedId() === questionId) setSelectedId(undefined);
      await saver.flush();
      // Refused, the stored gate may still name the column: keep it.
      if (saver.state() === 'failed') {
        options.notify.failure(
          'The column wasn’t deleted: the form couldn’t drop its question first.'
        );
        return false;
      }
      const result = await enqueueColumnWrite(
        columnId,
        (known) => known,
        (writes) => writes.remove(columnId)
      );
      if (!result) return false;
      if (result.isErr()) {
        options.notify.failure(
          `The column couldn’t be deleted: ${result.error.message}`
        );
        return false;
      }
      setLocal(undefined);
      await options.refetch();
      return true;
    },

    addSection(kind: SectionKind, index?: number) {
      const current = layout();
      if (!current) return undefined;
      const section = newSection(kind);
      const at =
        index ??
        (() => {
          const selected = selectedId();
          const containing = current.sections.findIndex(
            (item) =>
              item.id === targetSectionId() ||
              item.questions.some((question) => question.id === selected)
          );
          return containing >= 0 ? containing + 1 : current.sections.length;
        })();
      if (!commit(() => addLayoutSection(current, section, at)))
        return undefined;
      if (kind === 'questions') focusSection(section.id);
      return section.id;
    },

    moveSection(sectionId: string, index: number) {
      return commit((current) => moveLayoutSection(current, sectionId, index));
    },

    /** Drop the gate's rules that test questions no longer asked before it. */
    repairGate(sectionId: string) {
      commitPruned((current) => pruneBrokenRules(current, sectionId));
    },

    removeSection(sectionId: string) {
      commitPruned((current) => removeLayoutSection(current, sectionId));
    },

    updateSection(sectionId: string, patch: SectionPatch) {
      return commit((current) =>
        updateLayoutSection(current, sectionId, patch)
      );
    },
  };
}

export type Builder = ReturnType<typeof createBuilder>;
