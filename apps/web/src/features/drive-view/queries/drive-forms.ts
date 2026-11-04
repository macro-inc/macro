import type { FormEntity } from '@entity';
import type { ListedForm } from '@service-storage/generated/schemas/listedForm';
import type { DriveSelection } from '../context/drive-source';

/**
 * Forms, like databases, have no view history; list them in file tabs and in
 * the folder they are filed in.
 */
export function selectDriveForms(
  listed: readonly ListedForm[],
  selection: DriveSelection,
  userId: string | undefined
): FormEntity[] {
  const { location, scope } = selection;
  if (!userId || scope === 'attachments') return [];
  if (location.kind === 'tab' && location.tab === 'recent') return [];
  if (location.kind === 'folder' && !location.id) return [];
  const search = selection.search.trim().toLocaleLowerCase();
  return listed.flatMap(({ form, access }) => {
    if (form.isHiddenInDrive) return [];
    if (location.kind === 'folder' && form.projectId !== location.id) return [];
    if (
      location.kind === 'tab' &&
      location.tab === 'shared' &&
      form.ownerId === userId
    )
      return [];
    if (
      location.kind === 'tab' &&
      location.tab === 'owned' &&
      scope === 'default' &&
      form.ownerId !== userId
    )
      return [];
    if (search && !form.name.toLocaleLowerCase().includes(search)) return [];
    return [
      {
        type: 'form',
        id: form.id,
        name: form.name,
        ownerId: form.ownerId,
        createdAt: form.createdAt,
        access,
        projectId: form.projectId ?? undefined,
      },
    ];
  });
}

/** The databases made for forms kept out of Drive, which stay out with them. */
export function hiddenFormDatabases(
  listed: readonly ListedForm[]
): ReadonlySet<string> {
  return new Set(
    listed.flatMap(({ form }) =>
      form.isHiddenInDrive ? [form.databaseId] : []
    )
  );
}
