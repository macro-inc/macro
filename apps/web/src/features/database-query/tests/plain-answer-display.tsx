import { DatabaseMentionPlaceholder } from '@app/features/block-database/components/database-mention-label';
import { markdownToPlainText } from '@macro-inc/lexical-core/utils/parsers';
import type { JSX } from 'solid-js';
import {
  type AnswerDisplay,
  AnswerDisplayProvider,
  type AnswerRenderers,
} from '../context/answer-display';
import { unknownNames } from '../core/answer-cell';

/** Mentions as placeholders, rows and markdown as plain text. */
export const plainAnswerRenderers: AnswerRenderers = {
  mention: (_, entityType) => (
    <DatabaseMentionPlaceholder entityType={entityType} />
  ),
  row: (row) => row.label,
  text: (markdown) => markdownToPlainText(markdown),
};

/** Names nothing, so references read as counts. */
export const plainAnswerDisplay: AnswerDisplay = {
  ...plainAnswerRenderers,
  names: () => () => unknownNames,
};

export function PlainAnswerDisplay(props: { children: JSX.Element }) {
  return (
    <AnswerDisplayProvider value={plainAnswerDisplay}>
      {props.children}
    </AnswerDisplayProvider>
  );
}
