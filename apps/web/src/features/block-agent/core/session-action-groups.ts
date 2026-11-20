type Action = { id?: string; danger?: boolean };
type Groups<T> = {
  entity: T[];
  sender: T[];
  sharing: T[];
  macro: T[];
  notifications: T[];
  file: T[];
  delete: T[];
};

/** Preserve action owners; only the phone sheet's order and grouping change. */
export function sessionActionGroups<T extends Action>(
  groups: Groups<T>,
  renameId?: string
): Groups<T> {
  const all = [
    ...groups.entity,
    ...groups.sender,
    ...groups.sharing,
    ...groups.macro,
    ...groups.notifications,
    ...groups.file,
  ];
  const archive = all.find((action) => action.id === 'archive');
  const priority = [renameId, 'copy-link', 'tool-1']
    .filter((id): id is string => id !== undefined)
    .flatMap((id) => all.filter((action) => action.id === id));
  const remaining = all.filter(
    (action) => action !== archive && !priority.includes(action)
  );
  return {
    entity: [...priority, ...remaining],
    sender: [],
    sharing: [],
    macro: [],
    notifications: [],
    file: [],
    delete: [
      ...(archive ? [archive] : []),
      ...groups.delete.map((action) => ({ ...action, danger: true })),
    ],
  };
}
