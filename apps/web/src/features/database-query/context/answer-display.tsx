import { type Accessor, createContext, type JSX, useContext } from 'solid-js';
import type { DatabaseEntityType } from '../../database/core/column-inference';
import type { ReferenceNames } from '../core/answer-cell';
import type { QueryAnswer } from '../core/query';

/** A `row_id` cell's row, with what the answer calls it. */
export type AnswerRow = { id: string; table: string | null; label: string };

/** How a cell's mentions, rows and markdown text are drawn. */
export type AnswerRenderers = {
  mention: (id: string, entityType: DatabaseEntityType) => JSX.Element;
  /** A link that opens the row. */
  row: (row: AnswerRow) => JSX.Element;
  text: (markdown: string) => JSX.Element;
};

/** What an answer is drawn with, and the names of what it references. */
export type AnswerDisplay = AnswerRenderers & {
  /** Names what an answer references, as far as they are known. */
  names: (
    answer: Accessor<QueryAnswer | undefined>
  ) => Accessor<ReferenceNames>;
};

const AnswerDisplayContext = createContext<AnswerDisplay>();

export const AnswerDisplayProvider = AnswerDisplayContext.Provider;

export function useAnswerDisplay(): AnswerDisplay {
  const display = useContext(AnswerDisplayContext);
  if (!display)
    throw new Error(
      'useAnswerDisplay needs an AnswerDisplayProvider, such as AppAnswerDisplay.'
    );
  return display;
}
