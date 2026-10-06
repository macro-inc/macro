import {
  type DatabaseQueryChart,
  type DatabaseQueryDisplayMode,
  isDatabaseQueryChartMode,
} from '@macro-inc/lexical-core/nodes/databaseQueryData';
import { err, ok, type Result } from 'neverthrow';
import { createSignal, onCleanup } from 'solid-js';
import type { QueryComposerOptions } from '../context/query-context';
import { unknownNames } from '../core/answer-cell';
import {
  looksLikeReadQuery,
  type QueryAnswer,
  type QueryFailure,
  type QuerySchema,
  queryErrorMessage,
  queryFailureDetail,
} from '../core/query';
import { prepareQueryChart } from '../core/query-chart';

type Presentation = {
  title?: string;
  displayMode: DatabaseQueryDisplayMode;
  chart?: DatabaseQueryChart;
};

type AnswerPreview = {
  sql: string;
  prompt: string;
  answer: QueryAnswer;
  presentation: Presentation;
  context: QuestionContext;
  databaseId?: string;
};
type QuestionContext = { databaseId?: string; tableId?: string };
type ResolvedSource = { schema: QuerySchema; context: QuestionContext };

/** Asking previews through a read-only capability; saving a document remains the host's action. */
export function createQueryComposer(options: QueryComposerOptions) {
  const [prompt, setPromptSignal] = createSignal(options.initial.prompt);
  const [sql, setSqlSignal] = createSignal(options.initial.sql);
  const [presentation, setPresentation] = createSignal<Presentation>({
    title: options.initial.title,
    displayMode: options.initial.displayMode,
    chart: options.initial.chart,
  });
  const [sqlPrompt, setSqlPrompt] = createSignal(options.initial.prompt.trim());
  const [chosenTableId, setChosenTableId] = createSignal(
    options.initial.tableId
  );
  const tableId = () => chosenTableId() ?? options.schema().focusTableId;
  const requestSchema = () => ({
    ...options.schema(),
    focusTableId: tableId(),
  });
  const context = (): QuestionContext => ({
    databaseId: options.schema().databaseId,
    tableId: tableId(),
  });
  const isCurrentContext = (previous: QuestionContext) =>
    previous.databaseId === options.schema().databaseId &&
    previous.tableId === tableId();
  const [sqlContext, setSqlContext] = createSignal(context());
  const [phase, setPhase] = createSignal<'idle' | 'generating' | 'running'>(
    'idle'
  );
  const [error, setError] = createSignal<string>();
  const [preview, setPreview] = createSignal<AnswerPreview>();
  const [resolvedSource, setResolvedSource] = createSignal<ResolvedSource>();
  const schema = () => {
    const resolved = resolvedSource();
    return resolved && isCurrentContext(resolved.context)
      ? resolved.schema
      : requestSchema();
  };
  const [errorDetail, setErrorDetail] = createSignal<string>();
  const [generationPending, setGenerationPending] = createSignal(false);
  const [undo, setUndo] = createSignal<{
    sql: string;
    prompt: string;
    tableId?: string;
    presentation: Presentation;
    preview: AnswerPreview | undefined;
    resolvedSource: ResolvedSource | undefined;
  }>();
  let accepted = {
    sql: options.initial.sql,
    prompt: options.initial.prompt,
    tableId: tableId(),
  };
  let revision = 0;
  onCleanup(() => revision++);

  const clearError = () => {
    setError(undefined);
    setErrorDetail(undefined);
  };
  const edit = () => {
    revision++;
    if (!generationPending()) setPhase('idle');
    clearError();
  };
  const setPrompt = (value: string) => {
    edit();
    setPromptSignal(value);
  };
  const setSql = (value: string) => {
    edit();
    setSqlSignal(value);
    setSqlPrompt(prompt().trim());
    setSqlContext(context());
  };
  const selectTable = (id: string) => {
    if (id === tableId()) return;
    edit();
    setChosenTableId(id);
  };
  const questionChanged = () => sqlPrompt() !== prompt().trim();
  const sourceChanged = () => !isCurrentContext(sqlContext());
  const needsGeneration = () => questionChanged() || sourceChanged();
  const reportFailure = (failure: QueryFailure) => {
    setError(queryErrorMessage(failure, options.showSql));
    setErrorDetail(queryFailureDetail(failure));
  };

  async function readAnswer(
    statement: string,
    question: string,
    execution: number,
    source: QuestionContext,
    display = presentation()
  ): Promise<Result<void, QueryFailure>> {
    setPhase('running');
    const read = await options.read(statement, {
      databaseId: source.databaseId,
      source: schema(),
    });
    if (read.isErr()) return err(read.error);
    if (execution !== revision || !isCurrentContext(source))
      return ok(undefined);
    const answer = read.value;
    // A read attaches its verified source; without one there is none to show.
    setResolvedSource(
      answer.source ? { schema: answer.source, context: source } : undefined
    );
    setPreview({
      sql: statement,
      prompt: question,
      answer,
      presentation: display,
      context: source,
      databaseId: answer.source
        ? answer.source.databaseId
        : answer.readDatabaseIds.length === 1
          ? answer.readDatabaseIds[0]
          : source.databaseId,
    });
    setPresentation(display);
    accepted = { sql: statement, prompt: question, tableId: source.tableId };
    return ok(undefined);
  }

  /** Ask the assistant for the question's SQL, then read its answer. */
  async function ask(
    question: string,
    generation: number,
    source: QuestionContext
  ): Promise<Result<void, QueryFailure>> {
    if (
      source.tableId &&
      !requestSchema().tables.some((table) => table.id === source.tableId)
    )
      return err({ kind: 'table-unavailable' });
    const generated = await options.generate({
      prompt: question,
      sql: sql(),
      schema: requestSchema(),
    });
    if (generated.isErr()) return err(generated.error);
    const next = generated.value;
    if (generation !== revision || !isCurrentContext(source))
      return ok(undefined);
    const statement = next.sql.trim();
    setUndo({
      ...accepted,
      preview: preview(),
      presentation: presentation(),
      resolvedSource: resolvedSource(),
    });
    setResolvedSource(
      next.source ? { schema: next.source, context: source } : undefined
    );
    setSqlSignal(statement);
    setSqlPrompt(question);
    setSqlContext(source);
    return readAnswer(statement, question, generation, source, {
      title: next.title,
      displayMode: next.displayMode ?? 'scalar',
      chart: next.chart,
    });
  }

  const generate = async () => {
    const question = prompt().trim();
    if (!question || generationPending() || phase() !== 'idle') return;
    const generation = ++revision;
    const source = context();
    setPhase('generating');
    setGenerationPending(true);
    clearError();
    const asked = await ask(question, generation, source);
    if (asked.isErr() && generation === revision && isCurrentContext(source))
      reportFailure(asked.error);
    setGenerationPending(false);
    setPhase('idle');
  };

  const run = async () => {
    const statement = sql().trim();
    if (!statement || generationPending() || phase() !== 'idle') return;
    // Typed SQL is checked here; generated SQL was checked when it was parsed.
    if (!looksLikeReadQuery(statement)) {
      reportFailure({ kind: 'read-only' });
      return;
    }
    const execution = ++revision;
    const question = prompt().trim();
    const source = context();
    setSqlPrompt(question);
    setSqlContext(source);
    clearError();
    const read = await readAnswer(statement, question, execution, source);
    if (read.isErr() && execution === revision && isCurrentContext(source))
      reportFailure(read.error);
    if (execution === revision) setPhase('idle');
  };

  return {
    prompt,
    sql,
    phase,
    error,
    errorDetail,
    generationPending,
    preview,
    presentation,
    setDisplayMode: (displayMode: DatabaseQueryDisplayMode) =>
      setPresentation((current) => {
        const answer = preview()?.answer;
        if (answer && isDatabaseQueryChartMode(displayMode)) {
          const chart =
            prepareQueryChart(answer, displayMode, current.chart, unknownNames)
              .data?.config ??
            prepareQueryChart(answer, displayMode, undefined, unknownNames).data
              ?.config;
          return { ...current, displayMode, chart: chart ?? current.chart };
        }
        return { ...current, displayMode };
      }),
    setPrompt,
    setSql,
    schema,
    answerDatabaseId: () => preview()?.databaseId ?? schema().databaseId,
    tableId,
    selectTable,
    generate,
    run,
    questionChanged,
    sourceChanged,
    needsGeneration,
    refreshAnswer: () => (needsGeneration() ? generate() : run()),
    isCurrentPreview: () => {
      const current = preview();
      return (
        !!current &&
        current.sql === sql().trim() &&
        current.prompt === prompt().trim() &&
        isCurrentContext(current.context) &&
        phase() === 'idle' &&
        !error()
      );
    },
    canUndo: () => !!undo(),
    undoChanges: () => {
      const previous = undo();
      if (!previous) return;
      setChosenTableId(previous.tableId);
      setPrompt(previous.prompt);
      setSql(previous.sql);
      setPreview(previous.preview);
      setResolvedSource(previous.resolvedSource);
      setPresentation(previous.presentation);
      accepted = {
        sql: previous.sql,
        prompt: previous.prompt,
        tableId: previous.tableId,
      };
      setUndo(undefined);
    },
  };
}
