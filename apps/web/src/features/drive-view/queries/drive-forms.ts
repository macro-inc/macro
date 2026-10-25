import type { FormEntity } from '@entity';
import type { ListedForm } from '@service-storage/generated/schemas/listedForm';
import type { DriveSelection } from '../context/drive-source';

/** Forms, like databases, have no folder or view history; list them in file tabs. */
export function selectDriveForms(
  listed: readonly ListedForm[],
  selection: DriveSelection,
  userId: string | undefined
): FormEntity[] {
  const { location, scope } = selection;
  if (!userId || location.kind !== 'tab' || location.tab === 'recent')
    return [];
  if (scope === 'attachments') return [];
  const search = selection.search.trim().toLocaleLowerCase();
  return listed.flatMap(({ form, access }) => {
    if (form.isHiddenInDrive) return [];
    if (location.tab === 'shared' && form.ownerId === userId) return [];
    if (
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
