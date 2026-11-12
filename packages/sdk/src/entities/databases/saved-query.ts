import { match } from 'ts-pattern';
import { MacroError, unwrap } from '../../utils';
import type { MacroClient } from '../../utils/client';
import type { Database } from './database';
import type { DatabaseTable } from './table';

/** Display modes that draw a chart, and so need {@link SavedQueryChart} columns. */
export const SAVED_QUERY_CHART_MODES = [
  'bar',
  'line',
  'area',
  'scatter',
  'pie',
] as const;

/** A display mode that draws a chart. */
export type SavedQueryChartMode = (typeof SAVED_QUERY_CHART_MODES)[number];

/**
 * How an answer is shown: `scalar` for one number, inline in text; `table`
 * for rows; a chart mode to plot them.
 */
export type SavedQueryDisplayMode = 'scalar' | 'table' | SavedQueryChartMode;

/** Most `y` columns one chart plots. */
export const SAVED_QUERY_MAX_SERIES = 5;

/** Smallest and largest height, in pixels, a block's results viewport takes. */
export const SAVED_QUERY_HEIGHT_RANGE = { min: 96, max: 1600 } as const;

/** Which result columns a chart plots, named exactly as the `SELECT` returns them. */
export type SavedQueryChart = {
  /** The label column: the x axis, or the pie's slices. */
  x: string;
  /** One to five numeric result columns to plot, none equal to `x`. */
  y: string[];
  /** Chart heading. */
  title?: string;
  /** A column whose values split the one `y` series into a series per value. */
  color?: string;
  /** Stack bar or area series instead of setting them side by side. */
  stack?: boolean;
};

/** How an answer is shown: a chart mode always carries its chart. */
export type SavedQueryDisplay =
  | { mode: 'scalar' | 'table' }
  | { mode: SavedQueryChartMode; chart: SavedQueryChart };

/** Options for {@link Database.saveQuery} and {@link DatabaseTable.saveQuery}. */
export type SaveQueryOptions = {
  /** One `SELECT`, exactly as it ran with `query`. */
  sql: string;
  /** Short heading shown with the answer, e.g. "Invites per party". */
  title: string;
  /** The question in the user's words; by default, the title. */
  prompt?: string;
  /** How the answer is shown. */
  display: SavedQueryDisplay;
  /** Preferred height of the results viewport, in pixels, from 96 to 1600. */
  height?: number;
};

/** What {@link SavedQuery.withView} changes; everything else stays. */
export type SavedQueryView = {
  /** The new display mode. A chart mode needs a chart, given here or already set. */
  displayMode?: SavedQueryDisplayMode;
  /** The new chart columns. */
  chart?: SavedQueryChart;
  /** The new heading. */
  title?: string;
  /** The new viewport height, in pixels, from 96 to 1600. */
  height?: number;
};

const isChartMode = (
  mode: SavedQueryDisplayMode,
): mode is SavedQueryChartMode =>
  SAVED_QUERY_CHART_MODES.some((chartMode) => chartMode === mode);

const DISPLAY_MODES: readonly string[] = [
  'scalar',
  'table',
  ...SAVED_QUERY_CHART_MODES,
];

function checkDisplayMode(mode: SavedQueryDisplayMode): void {
  if (!DISPLAY_MODES.includes(mode))
    throw new MacroError(
      `display mode must be one of ${DISPLAY_MODES.join(', ')}; got ${String(mode)}`,
    );
}

/** The chart as the document block stores it: only set fields, `stack` only when true. */
function checkChart(chart: SavedQueryChart): SavedQueryChart {
  const named = (name: unknown) => typeof name === 'string' && !!name.trim();
  if (!named(chart.x))
    throw new MacroError(
      'chart.x must name the result column holding the labels.',
    );
  if (
    !Array.isArray(chart.y) ||
    !chart.y.length ||
    chart.y.length > SAVED_QUERY_MAX_SERIES
  )
    throw new MacroError(
      `chart.y must name one to ${SAVED_QUERY_MAX_SERIES} numeric result columns.`,
    );
  if (!chart.y.every(named))
    throw new MacroError('chart.y must not contain an empty column name.');
  if (new Set(chart.y).size !== chart.y.length)
    throw new MacroError('chart.y must not name a column twice.');
  if (chart.y.includes(chart.x))
    throw new MacroError('chart.y must not include the label column chart.x.');
  if (chart.title !== undefined && typeof chart.title !== 'string')
    throw new MacroError('chart.title must be a string.');
  if (chart.color !== undefined) {
    if (!named(chart.color))
      throw new MacroError('chart.color must name a result column.');
    if (chart.color === chart.x)
      throw new MacroError('chart.color must not be the label column chart.x.');
    if (chart.y.includes(chart.color))
      throw new MacroError(
        'chart.color must not be one of the chart.y columns.',
      );
    if (chart.y.length !== 1)
      throw new MacroError(
        'chart.color splits a single series; with chart.color, chart.y names one column.',
      );
  }
  if (chart.stack !== undefined && typeof chart.stack !== 'boolean')
    throw new MacroError('chart.stack must be a boolean.');
  return {
    x: chart.x,
    y: [...chart.y],
    ...(chart.title ? { title: chart.title } : {}),
    ...(chart.color ? { color: chart.color } : {}),
    ...(chart.stack ? { stack: true } : {}),
  };
}

function checkHeight(height: number | undefined): void {
  if (
    height !== undefined &&
    (!Number.isFinite(height) ||
      height < SAVED_QUERY_HEIGHT_RANGE.min ||
      height > SAVED_QUERY_HEIGHT_RANGE.max)
  )
    throw new MacroError(
      `height must be from ${SAVED_QUERY_HEIGHT_RANGE.min} to ${SAVED_QUERY_HEIGHT_RANGE.max} pixels.`,
    );
}

function checkTitle(title: string): string {
  const trimmed = typeof title === 'string' ? title.trim() : '';
  if (!trimmed) throw new MacroError('title must not be empty.');
  return trimmed;
}

/** A presentation that a document block can show. */
type Presentation = {
  title: string;
  prompt: string;
  displayMode: SavedQueryDisplayMode;
  chart: SavedQueryChart | undefined;
  height: number | undefined;
};

/** The presentation with every field checked, so a block from it renders. */
function checkPresentation(presentation: Presentation): Presentation {
  checkDisplayMode(presentation.displayMode);
  checkHeight(presentation.height);
  const chart =
    presentation.chart === undefined
      ? undefined
      : checkChart(presentation.chart);
  if (isChartMode(presentation.displayMode) && !chart)
    throw new MacroError(
      `a ${presentation.displayMode} chart needs chart columns (chart.x and chart.y).`,
    );
  return {
    ...presentation,
    title: checkTitle(presentation.title),
    chart,
  };
}

/** The tag a saved question's block is written in, in Markdown and documents. */
const BLOCK_TAG = 'm-db-query';

/**
 * A saved question: an immutable `SELECT` stored on the server, with how its
 * answer is shown. Its block ({@link toBlock}) renders the answer live,
 * re-running the question for whoever views it with their permissions, so it
 * stays current as the data changes. The SQL never leaves the server inside
 * the block; the block names the question by id.
 *
 * Changing the SQL means saving a new question. Changing how the answer
 * looks does not: {@link withView} returns the same question shown another
 * way.
 *
 * @mcp-exclude Built from a listing record; no id-only reference an MCP call can pass.
 */
export class SavedQuery {
  private constructor(
    private readonly client: MacroClient,
    /** Identifier of the saved question. */
    readonly id: string,
    /** The database whose tables win name resolution, if one was given. */
    readonly database: Database | undefined,
    /** The table the question is about, when it was saved from one. */
    readonly table: DatabaseTable | undefined,
    private readonly presentation: Presentation,
  ) {}

  /**
   * @internal Save a question. The server checks that the SQL is one
   * `SELECT` that compiles against the caller's databases, and that every
   * chart column is one it returns.
   */
  static async save(
    client: MacroClient,
    scope: { database: Database; table?: DatabaseTable },
    options: SaveQueryOptions,
  ): Promise<SavedQuery> {
    const title = checkTitle(options.title);
    const presentation = checkPresentation({
      title,
      prompt: options.prompt?.trim() || title,
      displayMode: options.display.mode,
      chart: 'chart' in options.display ? options.display.chart : undefined,
      height: options.height,
    });
    const saved = unwrap(
      await client.storage.saveDatabaseQuery({
        body: {
          definition: { version: 1, query: options.sql },
          databaseId: scope.database.id,
          ...(presentation.chart
            ? {
                chart: {
                  x: presentation.chart.x,
                  y: presentation.chart.y,
                  ...(presentation.chart.color
                    ? { color: presentation.chart.color }
                    : {}),
                },
              }
            : {}),
        },
      }),
    );
    return new SavedQuery(
      client,
      saved.id,
      scope.database,
      scope.table,
      presentation,
    );
  }

  /** The heading shown with the answer. */
  get title(): string {
    return this.presentation.title;
  }

  /** The question in the user's words. */
  get prompt(): string {
    return this.presentation.prompt;
  }

  /** How the answer is shown. */
  get displayMode(): SavedQueryDisplayMode {
    return this.presentation.displayMode;
  }

  /** Which result columns the chart plots, if it has one. */
  get chart(): SavedQueryChart | undefined {
    return this.presentation.chart;
  }

  /** Preferred height of the results viewport, in pixels, if set. */
  get height(): number | undefined {
    return this.presentation.height;
  }

  /**
   * The saved `SELECT`, read from the server.
   *
   * @readonly
   */
  async sql(): Promise<string> {
    const saved = unwrap(
      await this.client.storage.getDatabaseQuery({
        path: { query_id: this.id },
      }),
    );
    return match(saved.definition)
      .with({ version: 1 }, (definition) => definition.query)
      .exhaustive();
  }

  /**
   * The same question shown another way: a new display mode, chart, title or
   * height, as a document's block can be restyled in place. The question
   * itself never changes; save a new one to ask something else.
   *
   * A chart mode needs chart columns, given here or already set. A `scalar`
   * answer sits inline in text and every other mode is a block, so a
   * question cannot switch between `scalar` and another mode; save it again
   * with the mode it should have.
   *
   * @readonly
   */
  withView(view: SavedQueryView): SavedQuery {
    const displayMode = view.displayMode ?? this.displayMode;
    if ((displayMode === 'scalar') !== (this.displayMode === 'scalar'))
      throw new MacroError(
        `a ${this.displayMode} answer cannot become ${displayMode}: a scalar answer sits inline in text and every other mode is a block. Save the question again with the mode it should have.`,
      );
    return new SavedQuery(
      this.client,
      this.id,
      this.database,
      this.table,
      checkPresentation({
        ...this.presentation,
        displayMode,
        chart: view.chart ?? this.chart,
        title: view.title ?? this.title,
        height: view.height ?? this.height,
      }),
    );
  }

  /**
   * The block that shows the live answer, to put verbatim in a document's
   * Markdown or quote verbatim in edit instructions. Never write or edit a
   * block by hand: it names the question by id, and the SQL stays on the
   * server.
   *
   * @readonly
   */
  toBlock(): string {
    const json = JSON.stringify({
      queryId: this.id,
      ...(this.database ? { databaseId: this.database.id } : {}),
      ...(this.table ? { tableId: this.table.id } : {}),
      title: this.title,
      prompt: this.prompt,
      displayMode: this.displayMode,
      ...(this.chart ? { chart: this.chart } : {}),
      ...(this.height === undefined ? {} : { height: this.height }),
    });
    // `<` only occurs inside strings; escaping it keeps a title such as
    // "</m-db-query>" from closing the tag early.
    return `<${BLOCK_TAG}>${json.replaceAll('<', '\\u003c')}</${BLOCK_TAG}>`;
  }

  toJSON() {
    return {
      id: this.id,
      databaseId: this.database?.id,
      tableId: this.table?.id,
      title: this.title,
      prompt: this.prompt,
      displayMode: this.displayMode,
      chart: this.chart,
      height: this.height,
      block: this.toBlock(),
    };
  }
}
