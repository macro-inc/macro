import { createSignal, onCleanup } from 'solid-js';
import type { QueryComposerOptions } from '../context/query-context';
import {
  looksLikeReadQuery,
  QueryActionError,
  type QueryAnswer,
  QueryOutcomeUnknownError,
  type QuerySchema,
  queryErrorMessage,
} from '../core/query';
import {
  isChartMode,
  prepareQueryChart,
  type QueryChartConfig,
  type QueryDisplayMode,
} from '../core/query-chart';

type Presentation = { displayMode: QueryDisplayMode; chart?: QueryChartConfig };

type AnswerPreview = {
  sql: string;
  prompt: string;
  answer: QueryAnswer;
  explanation?: string;
  actionSummary?: string;
  presentation: Presentation;
  context: QuestionContext;
  databaseId?: string;
};
type QuestionContext = { databaseId?: string; tableId?: string };
type ResolvedSource = { schema: QuerySchema; context: QuestionContext };
const READ_ONLY_MESSAGE =
  'Questions only read your data. Start with SELECT, or ask a question above.';

/** Asking previews through a read-only capability; saving a document remains the host's action. */
export function createQueryComposer(options: QueryComposerOptions) {
  const [prompt, setPromptSignal] = createSignal(options.initial.prompt);
  const [sql, setSqlSignal] = createSignal(options.initial.sql);
  const [presentation, setPresentation] = createSignal<Presentation>({
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
  const [actionSummary, setActionSummary] = createSignal<string>();
  const [actionNeedsRevision, setActionNeedsRevision] = createSignal(false);
  const [outcomeUnknown, setOutcomeUnknown] = createSignal(false);
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
    setActionSummary(undefined);
    setActionNeedsRevision(false);
    setOutcomeUnknown(false);
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
  const reportError = (caught: unknown) => {
    setError(queryErrorMessage(caught));
    setErrorDetail(caught instanceof Error ? caught.message : String(caught));
  };

  async function readAnswer(
    statement: string,
    question: string,
    execution: number,
    source: QuestionContext,
    explanation?: string,
    display = presentation(),
    actionSummary?: string
  ) {
    const databaseId = schema().databaseId;
    setPhase('running');
    const answer = await options.read(statement, {
      databaseId: options.generationCanWrite ? undefined : source.databaseId,
      source: schema(),
    });
    if (execution !== revision || !isCurrentContext(source)) return;
    if (answer.source)
      setResolvedSource({ schema: answer.source, context: source });
    setPreview({
      sql: statement,
      prompt: question,
      answer,
      explanation,
      actionSummary,
      presentation: display,
      context: source,
      databaseId: answer.source
        ? answer.source.databaseId
        : answer.read_database_ids?.length === 1
          ? answer.read_database_ids[0]
          : databaseId,
    });
    setPresentation(display);
    accepted = { sql: statement, prompt: question, tableId: source.tableId };
  }

  const generate = async () => {
    const question = prompt().trim();
    if (
      !question ||
      generationPending() ||
      phase() !== 'idle' ||
      actionNeedsRevision() ||
      outcomeUnknown()
    )
      return;
    const generation = ++revision;
    const source = context();
    setPhase('generating');
    setGenerationPending(true);
    clearError();
    try {
      if (
        source.tableId &&
        !requestSchema().tables.some((table) => table.id === source.tableId)
      )
        throw new Error(
          'Choose an available table before asking this question.'
        );
      const next = await options.generate({
        prompt: question,
        sql: sql(),
        schema: requestSchema(),
      });
      if (generation !== revision || !isCurrentContext(source)) {
        if (options.generationCanWrite && next.actionSummary) {
          setActionSummary(next.actionSummary);
          setActionNeedsRevision(true);
          setUndo(undefined);
        }
        return;
      }
      setActionSummary(next.actionSummary);
      const statement = next.sql.trim();
      if (!looksLikeReadQuery(statement)) throw new Error(READ_ONLY_MESSAGE);
      setUndo(
        next.actionSummary
          ? undefined
          : {
              ...accepted,
              preview: preview(),
              presentation: presentation(),
              resolvedSource: resolvedSource(),
            }
      );
      setResolvedSource(
        next.source ? { schema: next.source, context: source } : undefined
      );
      setSqlSignal(statement);
      setSqlPrompt(question);
      setSqlContext(source);
      await readAnswer(
        statement,
        question,
        generation,
        source,
        next.explanation,
        { displayMode: next.displayMode ?? 'scalar', chart: next.chart },
        next.actionSummary
      );
    } catch (caught) {
      if (
        (generation === revision && isCurrentContext(source)) ||
        (options.generationCanWrite &&
          (caught instanceof QueryActionError ||
            caught instanceof QueryOutcomeUnknownError))
      ) {
        if (caught instanceof QueryActionError) {
          setActionSummary(caught.actionSummary);
          setActionNeedsRevision(true);
          setUndo(undefined);
        }
        if (caught instanceof QueryOutcomeUnknownError) {
          setActionSummary(undefined);
          setOutcomeUnknown(true);
          setUndo(undefined);
        }
        reportError(caught);
      }
    } finally {
      setGenerationPending(false);
      setPhase('idle');
    }
  };

  const run = async () => {
    const statement = sql().trim();
    if (!statement || generationPending() || phase() !== 'idle') return;
    if (!looksLikeReadQuery(statement)) {
      setError(READ_ONLY_MESSAGE);
      return;
    }
    const execution = ++revision;
    const question = prompt().trim();
    const source = context();
    setSqlPrompt(question);
    setSqlContext(source);
    clearError();
    try {
      await readAnswer(
        statement,
        question,
        execution,
        source,
        undefined,
        presentation(),
        actionSummary()
      );
    } catch (caught) {
      if (execution === revision && isCurrentContext(source))
        reportError(caught);
    } finally {
      if (execution === revision) setPhase('idle');
    }
  };

  return {
    prompt,
    sql,
    phase,
    error,
    errorDetail,
    actionSummary,
    actionNeedsRevision,
    outcomeUnknown,
    generationPending,
    preview,
    presentation,
    setDisplayMode: (displayMode: QueryDisplayMode) =>
      setPresentation((current) => {
        const answer = preview()?.answer;
        if (answer && isChartMode(displayMode)) {
          const chart =
            prepareQueryChart(answer, displayMode, current.chart).data
              ?.config ?? prepareQueryChart(answer, displayMode).data?.config;
          return { displayMode, chart: chart ?? current.chart };
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
      setActionSummary(previous.preview?.actionSummary);
      accepted = {
        sql: previous.sql,
        prompt: previous.prompt,
        tableId: previous.tableId,
      };
      setUndo(undefined);
    },
    useStarter: async (starter: { prompt: string; sql: string }) => {
      setPrompt(starter.prompt);
      setSql(starter.sql);
      await run();
    },
  };
}
