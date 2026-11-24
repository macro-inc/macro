/**
 * Opens an agent's references to code in the Changes pane: a link to a
 * changed file opens the pane on that file and lights the lines it names.
 * A relative link to another file opens it on GitHub at the head commit.
 */

import type { LineRange } from '@app/components/diff-view/model/lines';
import type {
  AppLinkDescriber,
  AppLinkOpener,
  AppLinkPreview,
} from '@core/component/LexicalMarkdown/component/core/app-link-opener';
import type { ChangedFile } from './core/changeset';
import {
  type CodeReference,
  findChangedFile,
  headBlobUrl,
  linkCodeReferences,
  parseCodeReference,
  readsAsRepositoryPath,
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

    // Until the changes load nothing is known about the file; the link keeps
    // its default handling rather than a wrong "not changed".
    const changeset = changes.model.changeset();
    if (!changeset) return false;
    const file = findChangedFile(reference.path, changeset.files);
    if (file) {
      changes.layout.open();
      changes.review.activate(file.path, pointedLines(file, reference.lines));
      return true;
    }

    // Past here only a path that reads as a file in the repository is ours to
    // answer; anything else, such as `example.com`, keeps the default handling.
    if (!readsAsRepositoryPath(reference, url)) return false;
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

/**
 * Describes the links the code link opener answers for their hover cards:
 * the file and its lines, then the folder it is in (`a.ts, line 2` over
 * `apps/web/src`), rather than the path twice.
 */
export function createCodeLinkDescriber(
  changes: ChangesController
): AppLinkDescriber {
  return (url) => {
    // Described exactly when the opener answers: not before the changes load.
    const changeset = changes.model.changeset();
    if (!changes.available() || !changeset) return undefined;
    const reference = parseCodeReference(url);
    if (!reference) return undefined;
    if (
      !findChangedFile(reference.path, changeset.files) &&
      !readsAsRepositoryPath(reference, url)
    )
      return undefined;
    return describeReference(reference);
  };
}

function describeReference(reference: CodeReference): AppLinkPreview {
  const slash = reference.path.lastIndexOf('/');
  const name = reference.path.slice(slash + 1);
  const lines = reference.lines;
  const where = !lines
    ? ''
    : lines.start === lines.end
      ? `, line ${lines.start}`
      : `, lines ${lines.start}-${lines.end}`;
  return {
    title: `${name}${where}`,
    subtitle: slash === -1 ? '' : reference.path.slice(0, slash),
  };
}

/** Agent prose with its references to changed files turned into links. */
export function linkChangedCode(
  changes: ChangesController | undefined,
  markdown: string
): string {
  if (!changes?.available()) return markdown;
  return linkCodeReferences(markdown, changes.model.files());
}
