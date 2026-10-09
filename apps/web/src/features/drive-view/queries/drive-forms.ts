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
