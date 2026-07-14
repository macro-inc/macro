const SPECIAL_PROJECTS = ['root', 'trash'];

export const getIsSpecialProject = (id: string) =>
  SPECIAL_PROJECTS.includes(id);
