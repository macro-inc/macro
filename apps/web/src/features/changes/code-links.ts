/**
 * Opens an agent's references to code in the Changes pane: a link to a
 * changed file opens the pane on that file and lights the lines it names.
 * A relative link to another file opens it on GitHub at the head commit.
 */

import type { LineRange } from '@app/components/diff-view/model/lines';
import type { AppLinkOpener } from '@core/component/LexicalMarkdown/component/core/app-link-opener';
import type { ChangedFile } from './core/changeset';
import {
  type CodeReference,
  findChangedFile,
  headBlobUrl,
  linkCodeSpans,
  namesFile,
  parseCodeReference,
} from './core/code-reference';
import type { ChangesController } from './primitives/create-changes';

function pointedLines(
  file: ChangedFile,
  lines: CodeReference['lines']
): LineRange | undefined {
  if (!lines) return undefined;
  return {
    path: file.path,
    // A deleted file only has its old lines to point at.
    side: file.kind === 'deleted' ? 'deletions' : 'additions',
    lineNumber: lines.start,
    endLineNumber: lines.end,
  };
}

/**
 * A link opener for code references, or one that declines every link while
 * the host can have no changes (a chat-only session).
 */
export function createCodeLinkOpener(
  changes: ChangesController
): AppLinkOpener {
  return (url) => {
    if (!changes.available()) return false;
    const reference = parseCodeReference(url);
    if (!reference) return false;

    const changeset = changes.model.changeset();
    const file = findChangedFile(reference.path, changeset?.files ?? []);
    if (file) {
      changes.layout.open();
      changes.review.activate(file.path, pointedLines(file, reference.lines));
      return true;
    }

    // Past here only a path that reads as a file is ours to answer; anything
    // else keeps the default handling.
    if (!namesFile(reference)) return false;
    const blob = headBlobUrl(changeset, reference);
    if (blob) {
      changes.context.host.openExternal(blob);
      return true;
    }
    changes.context.host.notify(
      `${reference.path} is not one of the changed files`,
      'failure'
    );
    return true;
  };
}

/** Agent prose with inline code naming a changed file turned into links. */
export function linkChangedCode(
  changes: ChangesController | undefined,
  markdown: string
): string {
  if (!changes?.available()) return markdown;
  return linkCodeSpans(markdown, changes.model.files());
}
