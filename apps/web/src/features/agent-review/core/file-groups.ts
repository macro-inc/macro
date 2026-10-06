import type { FileGroup } from './model';
import type { ReviewEntry } from './source';

/** Explicit agent groups augment the engine's generated/test labels. */
export function reviewFileGroups(
  files: ReviewEntry[],
  authored: FileGroup[]
): FileGroup[] {
  const existing = new Set(files.map((file) => file.path));
  const groups = authored.map((group) => ({
    ...group,
    files: group.files.filter((path) => existing.has(path)),
  }));
  const assigned = new Set(groups.flatMap((group) => group.files));
  for (const label of ['generated', 'test']) {
    if (groups.some((group) => group.key === label)) continue;
    const labeled = files.filter((file) => file.labels?.includes(label));
    const members = labeled
      .map((file) => file.path)
      .filter((path) => !assigned.has(path));
    const title = label === 'test' ? 'Tests' : 'Generated';
    if (members.length)
      groups.push({
        key: label,
        title:
          members.length < labeled.length
            ? `Other ${title.toLowerCase()}`
            : title,
        files: members,
        hidden: label === 'generated',
      });
  }
  return groups.filter((group) => group.files.length);
}

export function hiddenFiles(
  groups: FileGroup[],
  choices: ReadonlyMap<string, boolean>
): Set<string> {
  return new Set(
    groups
      .filter((group) => choices.get(group.key) ?? group.hidden)
      .flatMap((group) => group.files)
  );
}
