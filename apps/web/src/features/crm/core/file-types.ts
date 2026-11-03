/** One team-owned property; its value belongs to the source document. */
export const FILE_TYPE_PROPERTY_NAME = 'File type';

export const DEFAULT_FILE_TYPES = ['Contract', 'Proposal', 'Invoice', 'Notes'];

export type FileTypeOption = { id: string; name: string };
export type FileTypeCatalog = {
  definitionId: string;
  options: FileTypeOption[];
};

/** Undefined means unreadable or still loading; null means unclassified. */
export type FileClassification = string | null | undefined;

export function groupFilesByType<T extends { id: string }>(
  files: readonly T[],
  options: readonly FileTypeOption[],
  classifications: ReadonlyMap<string, FileClassification>,
  labels: { unclassified: string; unavailable: string }
): { id: string; name: string; files: T[] }[] {
  const groups = options.map((option) => ({ ...option, files: [] as T[] }));
  const untyped = {
    id: 'untyped',
    name: labels.unclassified,
    files: [] as T[],
  };
  const unavailable = {
    id: 'unavailable',
    name: labels.unavailable,
    files: [] as T[],
  };
  const byId = new Map(groups.map((group) => [group.id, group]));
  for (const file of files) {
    const classification = classifications.get(file.id);
    if (classification === null) untyped.files.push(file);
    else (byId.get(classification ?? '') ?? unavailable).files.push(file);
  }
  return [...groups, untyped, unavailable].filter(
    (group) => group.files.length > 0
  );
}
