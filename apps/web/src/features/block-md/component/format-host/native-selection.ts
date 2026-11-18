import type { EditorView } from '@macro-inc/lexical-wasm-view';
import { TEXT_TYPE_TO_FORMAT } from 'lexical';
import { queryApplication } from '../../../../lib/core/component/LexicalMarkdown/plugins/group-b/command';
import type { FormattingSelection } from './types';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Consume authoritative range facts from the matched native query producer. */
export function readNativeFormattingSelection(
  view: EditorView
): FormattingSelection | undefined {
  const generation = view.mirror.keyGeneration;
  if (generation === null)
    throw new Error('Native formatting requires an acknowledged generation');
  const result = queryApplication(view, 'group-b.format-facts', {});
  if (
    !isRecord(result) ||
    result.generation !== generation ||
    view.mirror.keyGeneration !== generation
  )
    throw new Error('Invalid native format facts generation');
  if (result.range === null) return undefined;
  const range = result.range;
  if (
    !isRecord(range) ||
    typeof range.format !== 'number' ||
    !Number.isInteger(range.format) ||
    range.format < 0 ||
    range.format > 0xffff_ffff ||
    typeof range.hasLinks !== 'boolean' ||
    !Array.isArray(range.elementsInRange)
  )
    throw new Error('Invalid native format facts');
  const kinds: unknown[] = range.elementsInRange;
  const elementsInRange = new Set<string>();
  for (const kind of kinds) {
    if (typeof kind !== 'string')
      throw new Error('Invalid native formatting element kind');
    elementsInRange.add(kind);
  }
  const format = range.format;
  return {
    bold: Boolean(format & TEXT_TYPE_TO_FORMAT.bold),
    italic: Boolean(format & TEXT_TYPE_TO_FORMAT.italic),
    underline: Boolean(format & TEXT_TYPE_TO_FORMAT.underline),
    strikethrough: Boolean(format & TEXT_TYPE_TO_FORMAT.strikethrough),
    code: Boolean(format & TEXT_TYPE_TO_FORMAT.code),
    superscript: Boolean(format & TEXT_TYPE_TO_FORMAT.superscript),
    subscript: Boolean(format & TEXT_TYPE_TO_FORMAT.subscript),
    highlight: Boolean(format & TEXT_TYPE_TO_FORMAT.highlight),
    hasLinks: range.hasLinks,
    elementsInRange,
  };
}

/** Current model selection text without clipboard HTML or internal serialization. */
export function readNativeSelectionText(view: EditorView): string {
  const generation = view.mirror.keyGeneration;
  if (generation === null)
    throw new Error(
      'Native selection text requires an acknowledged generation'
    );
  const result = queryApplication(view, 'group-b.selection-text', {});
  if (
    !isRecord(result) ||
    result.generation !== generation ||
    view.mirror.keyGeneration !== generation ||
    typeof result.text !== 'string'
  )
    throw new Error('Invalid native selection text');
  return result.text;
}
