import { formatDateMentionLabel } from '@core/util/dateMentionDisplay';
import type { DateDisplayMode } from '@macro-inc/lexical-core';
import { DateMentionNode } from '@macro-inc/lexical-core';
import type { LexicalEditor } from 'lexical';
import { INSERT_DATE_MENTION_COMMAND } from '../mentions/mentionsPlugin';

export function insertDateMention(
  editor: LexicalEditor,
  date: Date,
  displayMode: DateDisplayMode
) {
  if (!editor.hasNodes([DateMentionNode])) return;
  editor.dispatchCommand(INSERT_DATE_MENTION_COMMAND, {
    date: date.toISOString(),
    displayFormat: formatDateMentionLabel(date, displayMode),
    displayMode,
  });
}
