import type { LoroDoc } from 'loro-crdt';

/**
 * Styles and components that a canvas's artifacts share, keyed by name. They sit
 * in root maps beside the scene: each entry is one last-writer-wins string, and
 * clients that do not know them ignore them.
 */
export type ArtifactLibrary = Readonly<{
  styles: Readonly<Record<string, string>>;
  components: Readonly<Record<string, string>>;
}>;
export type ArtifactLibraryKind = keyof ArtifactLibrary;
export type ArtifactLibraryEdit = Readonly<{
  kind: ArtifactLibraryKind;
  name: string;
  /** Null removes the entry. */
  source: string | null;
}>;

/** Authoring limit for hosts and AI edits; stored entries are not rejected. */
export const ARTIFACT_LIBRARY_ENTRY_MAX_LENGTH = 64_000;

const ROOTS: Record<ArtifactLibraryKind, string> = {
  styles: 'artifactStyles',
  components: 'artifactComponents',
};

function strings(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object') return {};

  return Object.fromEntries(
    Object.entries(value).filter(
      (entry): entry is [string, string] => typeof entry[1] === 'string'
    )
  );
}

export function readArtifactLibrary(doc: LoroDoc): ArtifactLibrary {
  return {
    styles: strings(doc.getMap(ROOTS.styles).toJSON()),
    components: strings(doc.getMap(ROOTS.components).toJSON()),
  };
}

/** Stages edits on the document's open transaction; the caller commits. */
export function applyArtifactLibraryEdits(
  doc: LoroDoc,
  edits: readonly ArtifactLibraryEdit[]
) {
  for (const edit of edits) {
    const entries = doc.getMap(ROOTS[edit.kind]);
    if (edit.source === null) entries.delete(edit.name);
    else entries.set(edit.name, edit.source);
  }
}

export function subscribeArtifactLibrary(doc: LoroDoc, listener: () => void) {
  const unsubscribes = [
    doc.getMap(ROOTS.styles).subscribe(listener),
    doc.getMap(ROOTS.components).subscribe(listener),
  ];

  return () => {
    for (const unsubscribe of unsubscribes) unsubscribe();
  };
}
